const {OrgBase} = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const PRIORITIES = require('./constants.priorities');
const {thread} = require('./os.thread');
const {SigmoidPricing} = require('./lib.sigmoid_pricing');
const {PRICES} = require('./constants.market');

const RESERVE_LIMIT = 20000;
const REACTION_BATCH_SIZE = 1000;
const MIN_CREDITS = 25000;
const MIN_SELL_ORDER_SIZE = 1000;
const MAX_SELL_AMOUNT = 25000;

const MIN_ROOM_ENERGY = 100000;

const REQUEST_REACTION_TTL = 500;
const REQUEST_SELL_TTL = 500;
const REQUEST_DISTRIBUTE_BOOSTS = 30;

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
};

class Resources extends OrgBase {
  constructor(parent, trace) {
    super(parent, 'resources', trace);

    const setupTrace = this.trace.begin('constructor');

    this.pricer = new SigmoidPricing(PRICES);
    this.resources = {};
    this.sharedResources = {};

    this.availableReactions = {};

    this.threadRequestReactions = thread(REQUEST_REACTION_TTL)(() => {
      this.availableReactions = this.getReactions(trace);
      this.requestReactions();
    });

    this.threadRequestSellExtraResources = thread(REQUEST_SELL_TTL)(() => {
      this.requestSellResource();
    });

    this.threadDistributeBoosts = thread(REQUEST_DISTRIBUTE_BOOSTS)((trace) => {
      this.requestDistributeBoosts(trace);
    });

    setupTrace.end();
  }
  update(trace) {
    trace = trace.asId(this.id);

    const updateTrace = trace.begin('update');

    this.resources = this.getReserveResources(true);
    this.sharedResources = this.getSharedResources();

    this.threadRequestReactions();
    this.threadRequestSellExtraResources();
    this.threadDistributeBoosts(trace);

    updateTrace.end();
  }
  process(trace) {
    trace = trace.asId(this.id);

    const processTrace = trace.begin('process');

    this.updateStats();

    processTrace.end();
  }
  updateStats() {
    const stats = this.getStats();
    stats.resources = this.resources;

    const colonies = this.getKingdom().getColonies();
    stats.critical_resources = colonies.reduce((acc, colony) => {
      const colonyResources = colony.getReserveResources(true);
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

      const roomResources = room.getReserveResources(true);
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
  getReserveResources(includeTerminal) {
    return this.getKingdom().getColonies().reduce((acc, colony) => {
      // If colony doesn't have a terminal don't include it
      if (!colony.getPrimaryRoom() || !colony.getPrimaryRoom().hasTerminal()) {
        return acc;
      }

      const colonyResources = colony.getReserveResources(includeTerminal);
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
      if (!this.sharedResources[inputA] || this.sharedResources[inputA] < REACTION_BATCH_SIZE) {
        trace.log('dont have enough of first resource', {
          inputA,
          amountA: this.sharedResources[inputA] || 0,
          REACTION_BATCH_SIZE,
        });

        return;
      }

      const secondInputs = Object.keys(REACTIONS[inputA]);
      secondInputs.forEach((inputB) => {
        const output = REACTIONS[inputA][inputB];

        // If we don't have a full batch if input mark missing one and go to next
        if (!this.sharedResources[inputB] || this.sharedResources[inputB] < REACTION_BATCH_SIZE) {
          if (!missingOneInput[output]) {
            trace.log('dont have enough of second resource', {
              inputA,
              inputB,
              amountA: this.sharedResources[inputA] || 0,
              amountB: this.sharedResources[inputB] || 0,
              output,
              REACTION_BATCH_SIZE,
            });

            missingOneInput[output] = {inputA, inputB, output};
          }

          return;
        }

        // Check if we need more of the output
        if (this.sharedResources[output] > RESERVE_LIMIT && !overReserve[output]) {
          // overReserve[output] = {inputA, inputB, output};
          return;
        }

        // If reaction isn't already present add it
        if (!availableReactions[output]) {
          trace.log('adding available reaction', {
            inputA,
            inputB,
            amountA: this.sharedResources[inputA] || 0,
            amountB: this.sharedResources[inputB] || 0,
            output,
          });

          availableReactions[output] = {inputA, inputB, output};
        }
      });
    });

    availableReactions = this.prioritizeReactions(availableReactions);
    missingOneInput = this.prioritizeReactions(missingOneInput);
    // overReserve = this.prioritizeReactions(overReserve);

    const nextReactions = [].concat(availableReactions);
    if (missingOneInput.length && Game.market.credits > MIN_CREDITS) {
      nextReactions = nextReactions.concat(missingOneInput);
    }
    // nextReactions = nextReactions.concat(overReserve.reverse());

    trace.log('available reactions', {nextReactions, availableReactions, missingOneInput, overReserve});

    return nextReactions;
  }
  prioritizeReactions(reactions) {
    // Sorts reactions based on hard coded priorities, if kingdom has more
    // than reserve limit, reduce priority by 3
    return _.sortBy(Object.values(reactions), (reaction) => {
      let priority = PRIORITIES.REACTION_PRIORITIES[reaction['output']];
      if (this.resources[reaction['output']] >= RESERVE_LIMIT) {
        priority = priority - 3;
      }

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
  requestResource(room, resource, amount, ttl, trace) {
    trace.log('requesting resource', {room: room.id, resource, amount, ttl});

    // We can't request a transfer if room lacks a terminal
    if (!room.hasTerminal()) {
      trace.log('room does not have a terminal', {room: room.id});
      return;
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
      return;
    }

    const result = this.getRoomWithTerminalWithResource(resource, room.id);
    if (!result) {
      const details = {
        [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
        [MEMORY.MEMORY_ORDER_TYPE]: ORDER_BUY,
        [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY.MEMORY_ORDER_AMOUNT]: amount,
      };

      if (Game.market.credits < MIN_CREDITS) {
        trace.log('below reserve, not purchasing resource', {resource, amount});
        return;
      }

      trace.log('purchase resource', {room: room.id, resource, amount});
      room.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_BUY,
        details, ttl);
      return;
    }

    amount = _.min([result.amount, amount]);

    trace.log('requesting resource from other room', {room: result.room.id, resource, amount});

    result.room.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_TRANSFER, {
      [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_TRANSFER,
      [MEMORY.TRANSFER_RESOURCE]: resource,
      [MEMORY.TRANSFER_AMOUNT]: amount,
      [MEMORY.TRANSFER_ROOM]: room.id,
    }, ttl);
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
  requestReactions() {
    this.availableReactions.forEach((reaction) => {
      const priority = PRIORITIES.REACTION_PRIORITIES[reaction['output']];
      const details = {
        [MEMORY.REACTOR_TASK_TYPE]: TASKS.REACTION,
        [MEMORY.REACTOR_INPUT_A]: reaction['inputA'],
        [MEMORY.REACTOR_INPUT_B]: reaction['inputB'],
        [MEMORY.REACTOR_OUTPUT]: reaction['output'],
        [MEMORY.REACTOR_AMOUNT]: REACTION_BATCH_SIZE,
      };
      this.getKingdom().sendRequest(TOPICS.TASK_REACTION, priority, details,
        REQUEST_REACTION_TTL);
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
  requestDistributeBoosts(trace) {
    trace.log('balancing boosts');

    this.getKingdom().getColonies().forEach((colony) => {
      const primaryRoom = colony.getPrimaryRoom();
      if (!primaryRoom) {
        return;
      }

      const room = primaryRoom.getRoomObject();
      if (!room || !room.terminal || !room.storage) {
        return;
      }

      const booster = primaryRoom.booster;
      if (!booster) {
        return;
      }

      // PREDICTION not checking that the labs are still valid because of the hack
      // in runnable.labs that sets orgRoom.booster when creating the process
      // will bite me, you're welcome future Ryan

      const allEffects = booster.getEffects();
      const availableEffects = booster.getAvailableEffects();

      Object.entries(CRITICAL_EFFECTS).forEach(([effectName, compounds]) => {
        const effect = allEffects[effectName];
        if (!effect) {
          trace.log('missing effect', {effectName});
          return;
        }

        const bestCompound = compounds[0];
        const roomReserve = primaryRoom.getReserveResources(true);
        const currentAmount = roomReserve[bestCompound] || 0;

        const availableEffect = availableEffects[effectName];
        if (!availableEffect || currentAmount < MIN_CRITICAL_COMPOUND) {
          trace.log('maybe request/buy best compound', {
            colonyId: colony.id,
            bestCompound,
            currentAmount,
            credits: Game.market.credits,
            MIN_CRITICAL_COMPOUND,
          });

          this.requestResource(primaryRoom, bestCompound, MIN_CRITICAL_COMPOUND - currentAmount,
            REQUEST_DISTRIBUTE_BOOSTS, trace);
        } else {
          trace.log('have booster', {colonyId: colony.id, effectName, bestCompound, currentAmount});
        }
      });
    });
  }
}

module.exports = Resources;
