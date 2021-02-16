const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const PRIORITIES = require('./constants.priorities');
const MARKET = require('./constants.market');

const {doEvery} = require('./lib.scheduler');
const {returnSuccess} = require('./lib.behaviortree');

const RESERVE_LIMIT = 5000;
const REACTION_BATCH_SIZE = 1000;
const MIN_CREDITS = 10000;
const MIN_SELL_ORDER_SIZE = 1000;

const REQUEST_REACTION_TTL = 100;
const REQUEST_SELL_TTL = 60;
const REQUEST_DISTRIBUTE_BOOSTS = 30;

// Try to ensure that all colonies are ready to
// boost creeps with these effects
const CRITICAL_EFFECTS = {
  'upgradeController': ['XGH2O', 'GH2O', 'GH'],
  'heal': ['XLHO2', 'LHO2', 'LO'],
  'rangedAttack': ['XKHO2', 'KHO2', 'KO'],
  'damage': ['XGHO2', 'GHO2', 'GO'],
};
const MIN_CRITICAL_COMPOUND = 1000;

class Resources extends OrgBase {
  constructor(parent, trace) {
    super(parent, 'resources', trace);

    const setupTrace = this.trace.begin('constructor');

    this.resources = {};
    this.sharedResources = {};

    this.availableReactions = {};
    this.activeReactions = [];

    this.doRequestReactions = doEvery(REQUEST_REACTION_TTL)(() => {
      this.requestReactions();
    });

    this.doRequestSellExtraResources = doEvery(REQUEST_SELL_TTL)(() => {
      this.requestSellResource();
    });

    this.doDistributeBoosts = doEvery(REQUEST_DISTRIBUTE_BOOSTS)(() => {
      this.requestDistributeBoosts();
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.resources = this.getReserveResources(true);
    this.sharedResources = this.getSharedResources();

    this.activeReactions = this.getActiveReactions();
    this.availableReactions = this.getReactions();

    this.doRequestReactions();
    this.doRequestSellExtraResources();
    this.doDistributeBoosts();

    console.log(this);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    this.updateStats();

    processTrace.end();
  }
  toString() {
    const reactions = this.availableReactions.map((reaction) => {
      return reaction.output;
    });

    return `* Resource Gov - ` +
      `NextReactions: ${JSON.stringify(reactions)}, ` +
      `CurrentReactions: ${JSON.stringify(this.activeReactions)}`;
    // `SharedResources: ${JSON.stringify(this.sharedResources)}`;
  }
  updateStats() {
    const stats = this.getStats();
    stats.resources = this.resources;
  }
  getTerminalWithResource(resource) {
    const terminals = this.getKingdom().getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        console.log('no primary room for', colony.id);
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!room.terminal) {
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

      if (amount <= 0) {
        return acc;
      }

      return acc.concat({terminal: room.getTerminal(), amount});
    }, []);

    return _.sortBy(terminals, 'amount').shift();
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
      if (!room.terminal) {
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
      if (!colony.getPrimaryRoom() || !colony.getPrimaryRoom().terminal) {
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
  getReactors() {
    return this.getKingdom().getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!Object.keys(room.reactorMap).length) {
        return acc;
      }

      return acc.concat(Object.values(room.reactorMap));
    }, []);
  }
  getActiveReactions() {
    return this.getReactors().filter((reactor) => {
      return !reactor.isIdle();
    }).map((reactor) => {
      return {
        room: reactor.getRoom().id,
        output: reactor.getOutput(),
      };
    });
  }
  getReactions() {
    let availableReactions = {};
    let missingOneInput = {};
    //let overReserve = {};

    const firstInputs = Object.keys(REACTIONS);
    firstInputs.forEach((inputA) => {
      // If we don't have a full batch, move onto next
      if (!this.sharedResources[inputA] || this.sharedResources[inputA] < REACTION_BATCH_SIZE) {
        return;
      }

      const secondInputs = Object.keys(REACTIONS[inputA]);
      secondInputs.forEach((inputB) => {
        const output = REACTIONS[inputA][inputB];

        const alreadyRunning = _.filter(this.activeReactions, {output}).length > 0;
        if (alreadyRunning) {
          return;
        }

        // If we don't have a full batch if input mark missing one and go to next
        if (!this.sharedResources[inputB] || this.sharedResources[inputB] < REACTION_BATCH_SIZE) {
          if (!missingOneInput[output]) {
            missingOneInput[output] = {inputA, inputB, output};
          }

          return;
        }

        // Check if we need more of the output
        if (this.sharedResources[output] > RESERVE_LIMIT) {
          //overReserve[output] = {inputA, inputB, output};

          return;
        }

        if (!availableReactions[output]) {
          availableReactions[output] = {inputA, inputB, output};
        }
      });
    });

    missingOneInput = this.prioritizeReactions(missingOneInput);
    availableReactions = this.prioritizeReactions(availableReactions);
    //overReserve = this.prioritizeReactions(overReserve);

    if (missingOneInput.length && Game.market.credits > MIN_CREDITS) {
      availableReactions.push(missingOneInput.pop());
    }

    //availableReactions = availableReactions.concat(overReserve.reverse());

    return availableReactions;
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
  requestResource(room, resource, amount, ttl) {
    // We can't request a transfer if room lacks a terminal
    const terminal = room.getTerminal();
    if (!terminal) {
      console.log(`xxxxx Can't request resource for room without terminal: ${room.id}, ${resource}`);
      return;
    }

    // Don't sent transfer request if a terminal already has the task
    const inProgress = this.getTerminals().filter((orgTerminal) => {
      const task = orgTerminal.getTask();
      if (!task) {
        return false;
      }

      return task.details[MEMORY.TRANSFER_RESOURCE] === resource &&
        task.details[MEMORY.TRANSFER_ROOM] === room.id;
    }).length > 0;

    if (inProgress) {
      return;
    }

    const result = this.getTerminalWithResource(resource);
    if (!result) {
      const details = {
        [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
        [MEMORY.MEMORY_ORDER_TYPE]: ORDER_BUY,
        [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY.MEMORY_ORDER_AMOUNT]: amount,
      };

      if (Game.market.credits > MIN_CREDITS) {
        console.log('requesting purchase', resource, 'for', room.id, amount);

        room.terminal.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_BUY,
          details, ttl);
      } else {
        console.log('not enough credits to purchase', resource, 'for', room.id, amount);
      }

      return;
    }

    amount = _.min([terminal.amount, amount]);

    console.log('requesting transfer', resource, 'to', room.id, amount);

    result.terminal.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_TRANSFER, {
      [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_TRANSFER,
      [MEMORY.TRANSFER_RESOURCE]: resource,
      [MEMORY.TRANSFER_AMOUNT]: amount,
      [MEMORY.TRANSFER_ROOM]: room.id,
    }, ttl);
  }
  createBuyOrder(room, resource, amount) {
    const terminal = room.getTerminal();
    if (!terminal) {
      console.log(`xxxxx Can't create buy order for room without terminal ${room.id} ${resource}`);
      return;
    }

    // Check if we already have a buy order for the room and resource
    const duplicateBuyOrders = Object.values(Game.market.orders).filter((order) => {
      return order.type === ORDER_BUY && order.roomName === room.id &&
        order.resourceType === resource;
    });
    if (duplicateBuyOrders.length) {
      console.log(`already have buy order for ${amount}x ${resource}: ${JSON.stringify(duplicateBuyOrders)}`)
      return;
    }

    if (!MARKET.PRICES[resource]) {
      console.log(`no price set for ${resource}`);
      return;
    }

    const price = MARKET.PRICES[resource].buy;

    console.log(`creating buy order for ${amount}x ${resource} at ${price}`);

    // Create buy order
    const order = {
      type: ORDER_BUY,
      resourceType: resource,
      price: price,
      totalAmount: amount,
      roomName: room.id,
    }
    const result = Game.market.createOrder(order)
    if (result != OK) {
      console.log(`problem creating buy order ${result}: ${JSON.stringify(order)}`)
    }
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
      if (duplicateOrders.length) {
        console.log(`already have sell order for ${amount}x ${resource}: ${JSON.stringify(duplicateOrders)}`)
        return;
      }

      const source = this.getTerminalWithResource(resource);
      if (!source) {
        console.log(`SHOULD NOT HAPPEN: no terminals with resource: ${resource} ${excess}`);
        return;
      }

      const sellAmount = _.min([source.amount, excess]);

      const details = {
        [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
        [MEMORY.MEMORY_ORDER_TYPE]: ORDER_SELL,
        [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY.MEMORY_ORDER_AMOUNT]: sellAmount,
      };

      console.log(`sell ${sellAmount} of ${resource} from ${source.terminal.getRoom().id}`);

      source.terminal.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_SELL,
        details, REQUEST_SELL_TTL);
    });
  }
  requestDistributeBoosts() {
    this.getKingdom().getColonies().forEach((colony) => {
      const primaryRoom = colony.getPrimaryRoom();
      if (!primaryRoom) {
        return;
      }

      const booster = primaryRoom.getBooster();
      if (!booster) {
        return;
      }

      const allEffects = booster.getEffects();
      const availableEffects = booster.getAvailableEffects();

      Object.keys(CRITICAL_EFFECTS).forEach((effectName) => {
        const effect = allEffects[effectName];
        const availableEffect = availableEffects[effectName];
        let desiredCompound = null;

        if (!availableEffect) {
          desiredCompound = this.getDesiredCompound(effect, this.resources);

          // If the resource is available request transfer to room
          if (desiredCompound.amount < MIN_CRITICAL_COMPOUND) {
            this.requestResource(primaryRoom, desiredCompound.resource, MIN_CRITICAL_COMPOUND);
            return;
          }
        }

        const roomReserve = primaryRoom.getReserveResources(true);
        desiredCompound = this.getDesiredCompound(effect, roomReserve);
        if (desiredCompound.amount < MIN_CRITICAL_COMPOUND) {
          this.createBuyOrder(primaryRoom, desiredCompound.resource, MIN_CRITICAL_COMPOUND)
          return;
        }
      });
    });
  }
}

module.exports = Resources;
