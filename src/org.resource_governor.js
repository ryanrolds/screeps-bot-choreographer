const {OrgBase} = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const PRIORITIES = require('./constants.priorities');
const {thread} = require('./os.thread');
const {SigmoidPricing} = require('./lib.sigmoid_pricing');
const {PRICES} = require('./constants.market');
const {TASK_PHASE_REACT} = require('./runnable.reactor');

const RESERVE_LIMIT = 20000;
const REACTION_BATCH_SIZE = 1000;
const MIN_CREDITS = 200000;
const MIN_BOOST_CREDITS = 1000000;
const MIN_SELL_ORDER_SIZE = 1000;
const MAX_SELL_AMOUNT = 25000;
const MIN_ROOM_ENERGY = 100000;
const ENERGY_BALANCE_AMOUNT = 5000;

const UPDATE_RESOURCES_TTL = 50;
const REQUEST_REACTION_TTL = 250;
const REQUEST_SELL_TTL = 500;
const REQUEST_DISTRIBUTE_BOOSTS = 250;
const CONSUME_STATUS_TTL = 25;
const BALANCE_ENERGY_TTL = 50;

// Try to ensure that all colonies are ready to
// boost creeps with these effects
const MIN_CRITICAL_COMPOUND = 1000;
const CRITICAL_EFFECTS = {
  'upgradeController': ['XGH2O', 'GH2O', 'GH'],
  // 'capacity': ['XKH2O', 'KH2O', 'KH'],
  'heal': ['XLHO2', 'LHO2', 'LO'],
  'attack': ['XUH2O', 'UH2O', 'UH'],
  'rangedAttack': ['XKHO2', 'KHO2', 'KO'],
  'damage': ['XGHO2', 'GHO2', 'GO'],
  'dismantle': ['XZH2O', 'ZH2O', 'ZH'],
};

class Resources extends OrgBase {
  constructor(parent, trace) {
    super(parent, 'resources', trace);

    const setupTrace = this.trace.begin('constructor');

    this.pricer = new SigmoidPricing(PRICES);
    this.resources = {};
    this.sharedResources = {};
    this.availableReactions = {};
    this.reactorStatuses = [];
    this.roomStatuses = [];
    this.reactionStats = {};

    this.threadUpdateResources = thread('update_resources_thread', UPDATE_RESOURCES_TTL)((trace) => {
      this.resources = this.getReserveResources();
      this.sharedResources = this.getSharedResources();
    });

    this.threadRequestReactions = thread('request_reactions_thread', REQUEST_REACTION_TTL)((trace) => {
      this.availableReactions = this.getReactions(trace);
      this.requestReactions(trace);
    });

    this.threadRequestSellExtraResources = thread('request_sell_resources_tread', REQUEST_SELL_TTL)((trace) => {
      this.requestSellResource(trace);
    });

    this.threadDistributeBoosts = thread('distribute_boosts_thread', REQUEST_DISTRIBUTE_BOOSTS)((trace) => {
      this.distributeBoosts(trace);
    });

    this.threadConsumeStatuses = thread('statuses_thread', CONSUME_STATUS_TTL)(this.consumeStatuses.bind(this));
    this.threadBalanceEnergy = thread('balance_energy_thread', BALANCE_ENERGY_TTL)(this.balanceEnergy.bind(this));

    setupTrace.end();
  }
  update(trace) {
    trace = trace.begin('resource_governor_run');

    this.threadUpdateResources(trace);
    this.threadRequestReactions(trace);
    this.threadRequestSellExtraResources(trace);
    this.threadDistributeBoosts(trace);
    this.threadConsumeStatuses(trace);
    this.threadBalanceEnergy(trace);

    trace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    this.updateStats(processTrace);

    processTrace.end();
  }
  updateStats(trace) {
    const stats = this.getStats();
    stats.resources = this.resources;
    stats.reactions = this.reactionStats;

    const colonies = this.getKingdom().getColonies();
    stats.critical_resources = colonies.reduce((acc, colony) => {
      const colonyResources = colony.getReserveResources();
      acc[colony.id] = Object.values(CRITICAL_EFFECTS).reduce((totalScore, effectResources) => {
        for (let i = 0; i < effectResources.length; i++) {
          if (colonyResources[effectResources[i]] >= MIN_CRITICAL_COMPOUND) {
            return totalScore + 3 - i;
          }
        }

        return totalScore;
      }, 0);

      return acc;
    }, {});
  }
  getRoomWithTerminalWithResource(resource, notRoomName = null) {
    const terminals = this.getKingdom().getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        return acc;
      }

      // Don't return the room needing the resources
      if (notRoomName && room.id === notRoomName) {
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!room.hasTerminal()) {
        return acc;
      }

      const isCritical = Object.values(CRITICAL_EFFECTS).reduce((acc, compounds) => {
        if (acc) {
          return acc;
        }

        if (compounds.indexOf(resource) != -1) {
          return true;
        }

        return false;
      }, false);

      let amount = colony.getAmountInReserve(resource, true);

      if (isCritical) {
        amount -= MIN_CRITICAL_COMPOUND;
      }

      if (resource === RESOURCE_ENERGY && amount < MIN_ROOM_ENERGY) {
        return acc;
      }

      if (amount <= 0) {
        return acc;
      }

      return acc.concat({room: room, amount});
    }, []);

    return _.sortBy(terminals, 'amount').reverse().shift();
  }
  getTerminals() {
    return this.getKingdom().getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!room.terminal) {
        return acc;
      }

      return acc.concat(room.terminal);
    }, []);
  }
  getSharedResources() {
    const sharedResources = {};

    this.getKingdom().getColonies().forEach((colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        return;
      }

      // If colony doesn't have a terminal don't include it
      if (!room.hasTerminal()) {
        return;
      }

      const roomResources = room.getReserveResources();
      Object.keys(roomResources).forEach((resource) => {
        const isCritical = Object.values(CRITICAL_EFFECTS).reduce((isCritical, compounds) => {
          if (isCritical) {
            return isCritical;
          }

          if (compounds.indexOf(resource) != -1) {
            return true;
          }
        }, false);

        let amount = roomResources[resource];

        if (isCritical) {
          amount -= MIN_CRITICAL_COMPOUND;
        }

        if (amount < 0) {
          amount = 0;
        }

        roomResources[resource] = amount;

        if (!sharedResources[resource]) {
          sharedResources[resource] = 0;
        }

        sharedResources[resource] += amount;
      });
    });

    return sharedResources;
  }

  getReserveResources() {
    return this.getKingdom().getColonies().reduce((acc, colony) => {
      // If colony doesn't have a terminal don't include it
      if (!colony.getPrimaryRoom() || !colony.getPrimaryRoom().hasTerminal()) {
        return acc;
      }

      const colonyResources = colony.getReserveResources();
      Object.keys(colonyResources).forEach((resource) => {
        const current = acc[resource] || 0;
        acc[resource] = colonyResources[resource] + current;
      });

      return acc;
    }, {});
  }

  getAmountInReserve(resource) {
    return this.getKingdom().getColonies().reduce((acc, colony) => {
      return acc + colony.getAmountInReserve(resource);
    }, 0);
  }

  getReactions(trace) {
    let availableReactions = {};
    let missingOneInput = {};
    const overReserve = {};

    const firstInputs = Object.keys(REACTIONS);
    firstInputs.forEach((inputA) => {
      // If we don't have a full batch, move onto next
      if (!this.resources[inputA] || this.resources[inputA] < REACTION_BATCH_SIZE) {
        trace.log('dont have enough of first resource', {
          inputA,
          amountA: this.resources[inputA] || 0,
          REACTION_BATCH_SIZE,
        });

        return;
      }

      const secondInputs = Object.keys(REACTIONS[inputA]);
      secondInputs.forEach((inputB) => {
        const output = REACTIONS[inputA][inputB];

        // If we don't have a full batch if input mark missing one and go to next
        if (!this.resources[inputB] || this.resources[inputB] < REACTION_BATCH_SIZE) {
          if (!missingOneInput[output]) {
            trace.log('dont have enough of second resource', {
              inputA,
              inputB,
              amountA: this.resources[inputA] || 0,
              amountB: this.resources[inputB] || 0,
              output,
              REACTION_BATCH_SIZE,
            });

            missingOneInput[output] = {inputA, inputB, output};
          }

          return;
        }

        // Check if we need more of the output
        if (this.resources[output] > RESERVE_LIMIT && !overReserve[output]) {
          // overReserve[output] = {inputA, inputB, output};
          return;
        }

        // If reaction isn't already present add it
        if (!availableReactions[output]) {
          trace.log('adding available reaction', {
            inputA,
            inputB,
            amountA: this.resources[inputA] || 0,
            amountB: this.resources[inputB] || 0,
            output,
          });

          availableReactions[output] = {inputA, inputB, output};
        }
      });
    });

    availableReactions = this.prioritizeReactions(availableReactions, 0);
    missingOneInput = this.prioritizeReactions(missingOneInput, 5);
    // overReserve = this.prioritizeReactions(overReserve, 10);

    const nextReactions = [].concat(availableReactions);
    if (missingOneInput.length && Game.market.credits > MIN_CREDITS) {
      nextReactions = nextReactions.concat(missingOneInput);
    }
    // nextReactions = nextReactions.concat(overReserve.reverse());

    trace.log('available reactions', {nextReactions, availableReactions, missingOneInput, overReserve});

    return nextReactions;
  }

  prioritizeReactions(reactions, penalty) {
    return _.sortBy(Object.values(reactions), (reaction) => {
      let priority = PRIORITIES.REACTION_PRIORITIES[reaction['output']];

      // Reduce priority linearly based on amount of resource (more = lower priority)
      const amount = this.resources[reaction['output']] || 0;
      priority = priority * _.max([0, 1 - (amount / (RESERVE_LIMIT * 2))]);
      priority -= penalty;

      reaction['priority'] = priority;

      return priority;
    });
  }

  getDesiredCompound(effect, reserve) {
    // Returns fist compound (assumes sorted by priority) that has more
    // than minimum, or the compound with the most available
    return effect.compounds.reduce((acc, compound) => {
      const amountAvailable = reserve[compound.name] || 0;

      if (!acc) {
        return {
          resource: compound.name,
          amount: amountAvailable,
        };
      }

      if (acc.amount > MIN_CRITICAL_COMPOUND) {
        return acc;
      }

      if (acc.amount < amountAvailable) {
        return {
          resource: compound.name,
          amount: amountAvailable,
        };
      }

      return acc;
    }, null);
  }
  buyResource(room, resource, amount, ttl, trace) {
    trace.log('requesting resource purchase', {room: room.id, resource, amount, ttl});

    // We can't request a transfer if room lacks a terminal
    if (!room.hasTerminal()) {
      trace.log('room does not have a terminal', {room: room.id});
      return false;
    }

    const details = {
      [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
      [MEMORY.MEMORY_ORDER_TYPE]: ORDER_BUY,
      [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
      [MEMORY.MEMORY_ORDER_AMOUNT]: amount,
    };

    if (Game.market.credits < MIN_CREDITS) {
      trace.log('below min credits, not purchasing resource', {resource, amount});
      return false;
    }

    trace.log('purchase resource', {room: room.id, resource, amount});
    room.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_BUY,
      details, ttl);

    return true;
  }
  requestResource(room, resource, amount, ttl, trace) {
    trace.log('requesting resource transfer', {room: room.id, resource, amount, ttl});

    // We can't request a transfer if room lacks a terminal
    if (!room.hasTerminal()) {
      trace.log('room does not have a terminal', {room: room.id});
      return false;
    }

    // Don't send transfer request if a terminal already has the task
    const inProgress = this.getTerminals().filter((orgTerminal) => {
      const task = orgTerminal.getTask();
      if (!task) {
        return false;
      }

      return task.details[MEMORY.TRANSFER_RESOURCE] === resource &&
        task.details[MEMORY.TRANSFER_ROOM] === room.id;
    }).length > 0;

    if (inProgress) {
      trace.log('task already in progress', {room: room.id, resource, amount, ttl});
      return true;
    }

    const result = this.getRoomWithTerminalWithResource(resource, room.id);
    if (!result) {
      trace.log('no rooms with resource', {resource});
      return false;
    }

    amount = _.min([result.amount, amount]);

    trace.log('requesting resource from other room', {room: result.room.id, resource, amount});

    result.room.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_TRANSFER, {
      [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_TRANSFER,
      [MEMORY.TRANSFER_RESOURCE]: resource,
      [MEMORY.TRANSFER_AMOUNT]: amount,
      [MEMORY.TRANSFER_ROOM]: room.id,
    }, ttl);

    return true;
  }
  createBuyOrder(room, resource, amount, trace) {
    if (!room.hasTerminal()) {
      trace.log('room does not have terminal', {roomName: room.name});
      return;
    }

    // Check if we already have a buy order for the room and resource
    const duplicateBuyOrders = Object.values(Game.market.orders).filter((order) => {
      return order.type === ORDER_BUY && order.roomName === room.id &&
        order.resourceType === resource;
    });
    if (duplicateBuyOrders.length) {
      trace.log('already have an order for resource', {resource});
      return;
    }

    const currentAmount = this.resources[resource] || 0;
    const price = this.pricer.getPrice(ORDER_BUY, resource, currentAmount);

    // Create buy order
    const order = {
      type: ORDER_BUY,
      resourceType: resource,
      price: price,
      totalAmount: amount,
      roomName: room.id,
    };
    const result = Game.market.createOrder(order);
    trace.log('create order result', {order, result});
  }

  requestReactions(trace) {
    this.availableReactions.forEach((reaction) => {
      const details = {
        [MEMORY.REACTOR_TASK_TYPE]: TASKS.REACTION,
        [MEMORY.REACTOR_INPUT_A]: reaction['inputA'],
        [MEMORY.REACTOR_INPUT_B]: reaction['inputB'],
        [MEMORY.REACTOR_OUTPUT]: reaction['output'],
        [MEMORY.REACTOR_AMOUNT]: REACTION_BATCH_SIZE,
      };

      this.getKingdom().sendRequest(TOPICS.TASK_REACTION, reaction['priority'], details, REQUEST_REACTION_TTL);
    });

    const reactions = this.getKingdom().getTopics().getTopic(TOPICS.TASK_REACTION);
    trace.log('requested reactions', {
      reactions: reactions.map((r) => {
        return {
          output: r.details[MEMORY.REACTOR_OUTPUT],
          priority: r.priority,
        };
      }),
    });
  }

  requestSellResource() {
    Object.entries(this.sharedResources).forEach(([resource, amount]) => {
      if (resource === RESOURCE_ENERGY) {
        return;
      }

      const excess = amount - RESERVE_LIMIT;
      if (excess < MIN_SELL_ORDER_SIZE) {
        return;
      }

      // Check if we already have a buy order for the room and resource
      const duplicateOrders = Object.values(Game.market.orders).filter((order) => {
        return order.type === ORDER_SELL && order.resourceType === resource;
      });
      if (duplicateOrders.length && Game.market.credits > MIN_CREDITS) {
        return;
      }

      const result = this.getRoomWithTerminalWithResource(resource);
      if (!result) {
        return;
      }

      const sellAmount = _.min([result.amount, excess, MAX_SELL_AMOUNT]);

      const details = {
        [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
        [MEMORY.MEMORY_ORDER_TYPE]: ORDER_SELL,
        [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY.MEMORY_ORDER_AMOUNT]: sellAmount,
      };

      result.room.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_SELL,
        details, REQUEST_SELL_TTL);
    });
  }

  distributeBoosts(trace) {
    trace.log('balancing boosts');

    this.getKingdom().getColonies().forEach((colony) => {
      const colonyTrace = trace.withFields({colony: colony.id});
      const colonyEnd = colonyTrace.startTimer('colony');

      const primaryRoom = colony.getPrimaryRoom();
      if (!primaryRoom) {
        colonyEnd();
        return;
      }

      const room = primaryRoom.getRoomObject();
      if (!room || !room.terminal || !room.storage) {
        colonyEnd();
        return;
      }

      const boosterPos = primaryRoom.getBoosterPosition();
      if (!boosterPos) {
        colonyEnd();
        return;
      }

      // PREDICTION not checking that the labs are still valid because of the hack
      // in runnable.labs that sets orgRoom.booster when creating the process
      // will bite me, you're welcome future Ryan

      const allEffects = primaryRoom.getAllEffects();
      const availableEffects = primaryRoom.getLoadedEffects();
      const rallyFlagRoom = Game.flags['rally']?.pos.roomName;

      Object.entries(CRITICAL_EFFECTS).forEach(([effectName, compounds]) => {
        const effectTrace = colonyTrace.withFields({
          'effect': effectName,
          'compounds': compounds.length,
        });
        const effectsEnd = effectTrace.startTimer('effect');

        const effect = allEffects[effectName];
        if (!effect) {
          effectTrace.log('missing effect', {effectName});
          effectsEnd();
          return;
        }

        const bestCompound = compounds[0];
        const roomReserve = primaryRoom.getReserveResources();
        const currentAmount = roomReserve[bestCompound] || 0;

        const availableEffect = availableEffects[effectName];
        if (!availableEffect || currentAmount < MIN_CRITICAL_COMPOUND) {
          effectTrace.log('maybe request/buy best compound', {
            colonyId: colony.id,
            bestCompound,
            currentAmount,
            credits: Game.market.credits,
            MIN_CRITICAL_COMPOUND,
          });

          let minimumCritical = MIN_CRITICAL_COMPOUND;
          if (primaryRoom === rallyFlagRoom) {
            minimumCritical = MIN_CRITICAL_COMPOUND_RALLY;
          }

          const requested = this.requestResource(primaryRoom, bestCompound, minimumCritical - currentAmount,
            REQUEST_DISTRIBUTE_BOOSTS, effectTrace);

          // If we couldnt request resource, try buying
          if (!requested && Game.market.credits > MIN_BOOST_CREDITS) {
            this.buyResource(primaryRoom, bestCompound, minimumCritical - currentAmount,
              REQUEST_DISTRIBUTE_BOOSTS, effectTrace);
          }
        } else {
          effectTrace.log('have booster', {colonyId: colony.id, effectName, bestCompound, currentAmount});
        }

        effectsEnd();
      });

      colonyEnd();
    });
  }

  consumeStatuses(trace) {
    trace.log('consuming statues');

    const reactorStatuses = this.getKingdom().getTopics().getTopic(TOPICS.ACTIVE_REACTIONS) || [];
    this.reactorStatuses = reactorStatuses;
    trace.log('reactor statuses', {length: reactorStatuses.length});

    this.reactionStats = reactorStatuses.reduce((acc, status) => {
      const resource = status.details[MEMORY.REACTION_STATUS_RESOURCE];
      if (!acc[resource]) {
        acc[resource] = 0;
      }

      const phase = status.details[MEMORY.REACTION_STATUS_PHASE];
      if (phase === TASK_PHASE_REACT) {
        acc[resource] += 1;
      }

      return acc;
    }, {});

    const roomStatuses = this.getKingdom().getTopics().getTopic(TOPICS.ROOM_STATUES) || [];
    this.roomStatuses = roomStatuses;
    trace.log('room statuses', {length: roomStatuses.length});
  }

  balanceEnergy(trace) {
    if (this.roomStatuses.length < 2) {
      trace.log('not enough rooms to balance');
      return;
    }

    const hasTerminals = _.filter(this.roomStatuses, {details: {[MEMORY.ROOM_STATUS_TERMINAL]: true}});
    if (hasTerminals.length < 2) {
      trace.log('not enough terminals to balance');
      return;
    }

    const energySorted = _.sortByAll(hasTerminals, [
      ['details', MEMORY.ROOM_STATUS_ENERGY].join('.'),
    ]);
    const levelAndEnergySorted = _.sortByAll(hasTerminals, [
      ['details', MEMORY.ROOM_STATUS_LEVEL].join('.'),
      ['details', 1 - MEMORY.ROOM_STATUS_LEVEL_COMPLETED].join('.'),
      ['details', MEMORY.ROOM_STATUS_ENERGY].join('.'),
    ]);

    trace.log('sorted', {energySorted, levelAndEnergySorted});

    const sinkRoom = levelAndEnergySorted[0];
    const sourceRoom = energySorted[energySorted.length - 1];

    if (sinkRoom === sourceRoom) {
      trace.log('sink and source are same');
      return;
    }

    const energyDiff = sourceRoom.details[MEMORY.ROOM_STATUS_ENERGY] - sinkRoom.details[MEMORY.ROOM_STATUS_ENERGY];
    if (energyDiff < ENERGY_BALANCE_AMOUNT * 2) {
      trace.log('energy different too small, no need to send energy', {energyDiff});
      return;
    }

    const sourceRoomName = sourceRoom.details[MEMORY.ROOM_STATUS_NAME];
    const sinkRoomName = sinkRoom.details[MEMORY.ROOM_STATUS_NAME];
    const request = {
      [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_TRANSFER,
      [MEMORY.TRANSFER_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.TRANSFER_AMOUNT]: ENERGY_BALANCE_AMOUNT,
      [MEMORY.TRANSFER_ROOM]: sinkRoomName,
    };

    trace.notice('send energy request', {request});

    this.getKingdom().getRoomByName(sourceRoomName).sendRequest(TOPICS.TOPIC_TERMINAL_TASK,
      PRIORITIES.TERMINAL_ENERGY_BALANCE, request, BALANCE_ENERGY_TTL);
  }
}

module.exports = Resources;
