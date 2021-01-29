const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const MARKET = require('./constants.market');


const TASK_PHASE_HAUL_RESOURCE = 'phase_transfer_resource';
const TASK_PHASE_TRANSACT = 'phase_transact';
const TASK_PHASE_TRANSFER = 'phase_transfer';
const TASK_TTL = 100;

class Terminal extends OrgBase {
  constructor(parent, terminal, trace) {
    super(parent, terminal.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.terminal = terminal;
    this.room = parent.getRoomObject();
    this.task = this.room.memory[MEMORY.TERMINAL_TASK] || null;

    setupTrace.end();
  }
  update() {
    console.log(this);

    if (this.task) {
      const details = this.task.details;
      const taskType = details[MEMORY.TERMINAL_TASK_TYPE];

      switch (taskType) {
        case TASKS.TASK_TRANSFER:
          this.transferResource(details);
          break;
        case TASKS.TASK_MARKET_ORDER:
          const orderType = details[MEMORY.MEMORY_ORDER_TYPE];

          // Maintain task TTL. We want to abort hard to perform tasks
          let ttl = details[MEMORY.TASK_TTL];
          if (ttl === undefined) {
            ttl = TASK_TTL;
          }
          if (ttl < 0) {
            this.clearTask();
            return;
          } else {
            this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_TTL] = ttl - 1;
          }

          // Perform market order
          if (orderType === ORDER_SELL) {
            this.sell(details);
          } else if (orderType === ORDER_BUY) {
            this.buy(details);
          } else {
            console.log('invalid order type', orderType);
            this.clearTask();
          }

          break;
        default:
          console.log('BROKEN TASK DETAILS', taskType);
          this.clearTask();
      }

      return;
    }

    // If reserve is low then transfer energy back
    const terminalAmount = this.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) < 2000 && terminalAmount > 0) {
      const reserve = this.getRoom().getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
      if (!reserve) {
        return;
      }

      const details = {
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: this.terminal.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_AMOUNT]: terminalAmount,
        [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id,
      };
      this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 0.8, details);
    }
  }
  process() {
    if (!this.room.memory[MEMORY.TERMINAL_TASK]) {
      const task = this.getNextRequest(TOPICS.TOPIC_TERMINAL_TASK);
      if (task) {
        this.task = task;
        this.room.memory[MEMORY.TERMINAL_TASK] = task;
      }
    }
  }
  transferResource(task) {
    const resource = task[MEMORY.TRANSFER_RESOURCE];
    const amount = task[MEMORY.TRANSFER_AMOUNT];
    const roomId = task[MEMORY.TRANSFER_ROOM];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        if (this.terminal.store.getUsedCapacity(resource) >= amount) {
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          break;
        }

        this.haulResourceToTerminal(resource, amount);
        break;
      case TASK_PHASE_TRANSFER:
        const energyReady = this.haulTransferEnergyToTerminal(amount, roomId);
        if (!energyReady) {
          break;
        }

        const result = this.terminal.send(resource, amount, roomId);
        if (result === OK) {
          this.clearTask();
          break;
        }

        break;
      default:
        console.log('BROKEN MARKET LOGIC', phase);
        this.clearTask();
    }
  }
  buy(task) {
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE];
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT];
    const currentAmount = this.terminal.store.getUsedCapacity(resource);
    const missingAmount = amount - currentAmount;

    if (currentAmount >= amount) {
      this.clearTask();
      return;
    }

    let orders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: resource});
    if (!orders.length) {
      this.clearTask();
      return;
    }

    orders = _.sortBy(orders, 'price');

    const order = orders[0];
    const dealAmount = Math.min(missingAmount, order.remainingAmount);
    const energyReady = this.haulTransferEnergyToTerminal(dealAmount, order.roomName);
    if (!energyReady) {
      return;
    }

    if (this.terminal.cooldown) {
      return;
    }

    const result = Game.market.deal(order.id, dealAmount, this.room.name);
    console.log('deal', result, JSON.stringify(order));
  }
  sell(task) {
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE];
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        if (this.terminal.store.getUsedCapacity(resource) >= amount) {
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSACT;
          break;
        }

        this.haulResourceToTerminal(resource, amount);
        break;
      case TASK_PHASE_TRANSACT:
        // Check if we are done selling
        if (this.terminal.store.getUsedCapacity(resource) === 0) {
          this.clearTask();
          break;
        }

        let orders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: resource});
        if (!orders.length) {
          this.clearTask();
          return;
        }

        orders = orders.filter((order) => {
          return order.remainingAmount > 0;
        });

        orders = _.sortBy(orders, 'price').reverse();

        const order = orders[0];
        if (order.price < MARKET.PRICES[resource]) {
          this.clearTask();
          return;
        }

        const dealAmount = Math.min(amount, order.remainingAmount);
        const energyReady = this.haulTransferEnergyToTerminal(dealAmount, order.roomName);
        if (!energyReady) {
          return;
        }

        if (this.terminal.cooldown) {
          return;
        }

        const result = Game.market.deal(order.id, dealAmount, this.room.name);
        console.log('deal', result, JSON.stringify(order));
        break;
      default:
        console.log('BROKEN MARKET LOGIC', phase);
        this.clearTask();
    }
  }
  toString() {
    let taskSummary = 'None';
    const task = this.getTask();
    if (task) {
      const taskType = task.details[MEMORY.TERMINAL_TASK_TYPE];
      const orderType = task.details[MEMORY.MEMORY_ORDER_TYPE] || 'NA';
      const roomId = task.details[MEMORY.TRANSFER_ROOM] || 'NA';
      let resource = task.details[MEMORY.TRANSFER_RESOURCE];
      let amount = task.details[MEMORY.TRANSFER_AMOUNT];


      if (taskType === TASKS.TASK_MARKET_ORDER) {
        resource = task.details[MEMORY.MEMORY_ORDER_RESOURCE];
        amount = task.details[MEMORY.MEMORY_ORDER_AMOUNT];
      }

      taskSummary = `Task Type: ${taskType}, Order Type: ${orderType}, Resource: ${resource}, ` +
        `Amount: ${amount}, Room: ${roomId} `;
    }

    return `---- Terminal - Task: (${taskSummary}), Resources: ${JSON.stringify(this.getResources())}`;
  }
  updateStats() {

  }
  isIdle() {
    return !!this.room.memory[MEMORY.TERMINAL_TASK];
  }
  getTask() {
    return this.room.memory[MEMORY.TERMINAL_TASK] || null;
  }
  clearTask() {
    delete this.room.memory[MEMORY.TERMINAL_TASK];
  }
  getResources() {
    const resources = {};
    Object.keys(this.terminal.store).forEach((resource) => {
      resources[resource] = this.terminal.store.getUsedCapacity(resource);
    });

    return resources;
  }
  haulResourceToTerminal(resource, amount) {
    const numHaulers = _.filter(this.getRoom().assignedCreeps, (creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === resource &&
        creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] === this.terminal.id;
    }).length;

    // If we already have a hauler assigned, don't assign more
    if (numHaulers) {
      return;
    }

    const reserve = this.getRoom().getReserveStructureWithMostOfAResource(resource);
    if (!reserve) {
      this.clearTask();
      return;
    }

    const neededAmount = amount - this.terminal.store.getUsedCapacity(resource);

    const details = {
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: neededAmount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.terminal.id,
    };

    this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 0.8, details);
  }
  haulTransferEnergyToTerminal(amount, destinationRoom) {
    const energyRequired = Game.market.calcTransactionCost(amount, this.room.name, destinationRoom);
    if (this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < energyRequired) {
      const reserve = this.getRoom().getReserveStructureWithMostOfAResource(RESOURCE_ENERGY);
      if (!reserve) {
        return false;
      }

      // If we are low on energy don't take any from reserve
      if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) > 20000) {
        const details = {
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
          [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
          [MEMORY.MEMORY_HAUL_AMOUNT]: energyRequired,
          [MEMORY.MEMORY_HAUL_DROPOFF]: this.terminal.id,
        };

        this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details);

        return false;
      } else {
        console.log(this.getRoom().id, 'does not have energy to send');
        return false;
      }

      return true;
    }

    return true;
  }
}

module.exports = Terminal;
