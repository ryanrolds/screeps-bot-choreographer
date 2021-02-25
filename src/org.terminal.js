const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const MARKET = require('./constants.market');
const {doEvery} = require('./lib.scheduler');

const TASK_PHASE_HAUL_RESOURCE = 'phase_transfer_resource';
const TASK_PHASE_TRANSACT = 'phase_transact';
const TASK_PHASE_TRANSFER = 'phase_transfer';
const TASK_TTL = 100;

const MAX_TERMINAL_ENERGY = 10000;

const REQUEST_HAUL_RESOURCE_TTL = 20;
const REQUEST_RETURN_ENERGY_TTL = 20;
const ORDER_MGMT_TTL = 55;

class Terminal extends OrgBase {
  constructor(parent, terminal, trace) {
    super(parent, terminal.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.terminal = terminal;
    this.room = parent.getRoomObject();
    this.task = this.room.memory[MEMORY.TERMINAL_TASK] || null;

    this.doHaulRequest = doEvery(REQUEST_HAUL_RESOURCE_TTL)((pickup, resource, amount, priority) => {
      this.sendHaulRequest(pickup, resource, amount, priority);
    });

    this.doReturnEnergy = doEvery(REQUEST_RETURN_ENERGY_TTL)((amount) => {
      this.sendEnergyToStorage(amount);
    });

    this.doUpdateOrders = doEvery(ORDER_MGMT_TTL)((trace) => {
      this.updateOrders(trace);
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.room = this.parent.getRoomObject();
    if (!this.room) {
      updateTrace.end();
      return;
    }

    this.terminal = Game.getObjectById(this.id);
    if (!this.terminal) {
      // console.log(`game object for terminal id ${this.id} not found`)
      updateTrace.end();
      return;
    }

    this.task = this.room.memory[MEMORY.TERMINAL_TASK] || null;

    console.log(this);

    updateTrace.end();
  }
  process(trace) {
    // console.log("terminal process", this.id)

    const processTrace = trace.begin('process');

    if (!this.terminal) {
      processTrace.log(this.id, 'terminal not found', {});
      processTrace.end();
      return;
    }

    if (!this.task) {
      const task = this.getNextRequest(TOPICS.TOPIC_TERMINAL_TASK);
      if (task) {
        processTrace.log(this.id, 'got new task', {task});
        this.task = task;
        this.room.memory[MEMORY.TERMINAL_TASK] = task;
      }
    }

    if (this.task) {
      this.processTask(processTrace);
    }

    // If reserve is low then transfer energy back
    const terminalAmount = this.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    if (terminalAmount > MAX_TERMINAL_ENERGY) {
      this.doReturnEnergy(terminalAmount - MAX_TERMINAL_ENERGY);
    }

    this.doUpdateOrders(processTrace);

    processTrace.end();
  }
  processTask(trace) {
    trace.log(this.id, 'processing task', {task: this.task});

    const details = this.task.details;
    const taskType = details[MEMORY.TERMINAL_TASK_TYPE];

    switch (taskType) {
      case TASKS.TASK_TRANSFER:
        this.transferResource(details, trace);
        break;
      case TASKS.TASK_MARKET_ORDER:
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
        const orderType = details[MEMORY.MEMORY_ORDER_TYPE];
        if (orderType === ORDER_SELL) {
          this.sell(details);
        } else if (orderType === ORDER_BUY) {
          this.buy(details);
        } else {
          // console.log('invalid order type', orderType);
          this.clearTask();
        }

        break;
      default:
        // console.log('BROKEN TASK DETAILS', taskType);
        this.clearTask();
    }
    return;
  }
  transferResource(task, trace) {
    const resource = task[MEMORY.TRANSFER_RESOURCE];
    const amount = task[MEMORY.TRANSFER_AMOUNT];
    const roomId = task[MEMORY.TRANSFER_ROOM];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    trace.log(this.id, 'transfer resource', {resource, amount, roomId, phase});

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        const terminalAmount = this.terminal.store.getUsedCapacity(resource);
        if (terminalAmount >= amount) {
          trace.log(this.id, 'terminal amount gte desired amount', {terminalAmount, amount});
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          break;
        }

        const pickup = this.getRoom().getReserveStructureWithMostOfAResource(resource, false);
        if (!pickup) {
          if (!terminalAmount) {
            trace.log(this.id, 'no pickup and no resources in terminal', {});

            this.clearTask();
            break;
          }

          trace.log(this.id, 'no pickup, but resources in terminal', {terminalAmount});

          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TRANSFER_AMOUNT] = terminalAmount;
          break;
        }

        trace.log(this.id, 'requesting resource transfer to terminal', {pickup: pickup.id, resource, amount});

        this.haulResourceToTerminal(pickup, resource, amount);
        break;
      case TASK_PHASE_TRANSFER:
        const energyReady = this.haulTransferEnergyToTerminal(amount, roomId);
        if (!energyReady) {
          trace.log(this.id, 'energy not ready', {amount, roomId});
          break;
        }

        const result = this.terminal.send(resource, amount, roomId);

        trace.log(this.id, 'sending', {resource, amount, roomId, result});

        if (result !== OK) {
          // console.log("problem sending resource", this.id, resource, amount, roomId, result)
        }

        this.clearTask();

        break;
      default:
        // console.log('BROKEN MARKET LOGIC', phase);
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

    if (order.price > MARKET.PRICES[resource].buy) {
      // console.log(`no sell orders for ${resource} below ${MARKET.PRICES[resource].buy} - closest ${order.price}`);
      this.clearTask();
      return;
    }

    const dealAmount = Math.min(missingAmount, order.remainingAmount);
    const energyReady = this.haulTransferEnergyToTerminal(dealAmount, order.roomName);
    if (!energyReady) {
      return;
    }

    if (this.terminal.cooldown) {
      return;
    }

    Game.market.deal(order.id, dealAmount, this.room.name);
  }
  sell(task) {
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE];
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        const terminalAmount = this.terminal.store.getUsedCapacity(resource);
        if (terminalAmount >= amount) {
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSACT;
          break;
        }

        const pickup = this.getRoom().getReserveStructureWithMostOfAResource(resource, false);
        if (!pickup) {
          if (!terminalAmount) {
            // console.log('clearing task no pickup and no terminal amount');
            this.clearTask();
            break;
          }

          // console.log(`no pickup locations for ${resource}, using terminal amount`);
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSACT;
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.MEMORY_ORDER_AMOUNT] = terminalAmount;
          break;
        }

        this.haulResourceToTerminal(pickup, resource, amount);
        break;
      case TASK_PHASE_TRANSACT:
        // Check if we are done selling
        if (this.terminal.store.getUsedCapacity(resource) === 0 || amount < 1) {
          this.clearTask();
          break;
        }

        let orders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: resource});

        orders = orders.filter((order) => {
          return order.remainingAmount > 0;
        });

        orders = _.sortBy(orders, 'price').reverse();
        const order = orders[0];

        if (!orders.length || order.price < MARKET.PRICES[resource].sell) {
          // Check if we already have a sell order for the room and resource
          const duplicateBuyOrders = Object.values(Game.market.orders).filter((order) => {
            return order.type === ORDER_SELL && order.resourceType === resource &&
              order.roomName === this.room.name && order.remainingAmount > 0;
          });
          if (duplicateBuyOrders.length) {
            // console.log(`already have sell order for ${amount}x ${resource} from ${this.room.name}: ` +
            //  `${JSON.stringify(duplicateBuyOrders)}`)
            this.clearTask();
            return;
          }

          if (!MARKET.PRICES[resource]) {
            // console.log(`no price set for ${resource}`);
            this.clearTask();
            return;
          }

          const price = MARKET.PRICES[resource].sell;

          // console.log(`creating sell order for ${amount}x ${resource} at ${price}`);

          // Create buy order
          const order = {
            type: ORDER_SELL,
            resourceType: resource,
            price: price,
            totalAmount: amount,
            roomName: this.room.name,
          };
          const result = Game.market.createOrder(order);
          if (result != OK) {
            // console.log(`problem creating sell order ${result}: ${JSON.stringify(order)}`)
          }

          this.clearTask();
          return;
        }

        const dealAmount = _.min([amount, order.remainingAmount]);
        const energyReady = this.haulTransferEnergyToTerminal(dealAmount, order.roomName);
        if (!energyReady) {
          return;
        }

        if (this.terminal.cooldown) {
          return;
        }

        const result = Game.market.deal(order.id, dealAmount, this.room.name);
        // console.log(`tried to sell ${dealAmount} of ${resource} - result ${result}`);
        if (result == OK) {
          this.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.MEMORY_ORDER_AMOUNT] -= dealAmount;
        }

        break;
      default:
        console.log('BROKEN MARKET LOGIC', phase);
        this.clearTask();
    }
  }
  updateOrders(trace) {
    // Check if we already have a sell order for the room and resource
    Object.values(Game.market.orders).filter((order) => {
      return order.roomName === this.room.name;
    }).forEach((order) => {
      if (order.remainingAmount === 0) {
        trace.log(this.id, 'order is complete; cancelling', {orderId: order.id});
        Game.market.cancelOrder(order.id);
        return;
      }

      const missingAmount = order.amount < order.remainingAmount;
      if (missingAmount > 0) {
        const pickup = this.getRoom().getReserveStructureWithMostOfAResource(order.resourceType, false);
        if (!pickup) {
          trace.log(this.id, 'order missing resource and no pickup; cancelling',
            {orderId: order.id, missingAmount, resource: order.resourceType});
          Game.market.cancelOrder(order.id);
        } else {
          trace.log(this.id, 'requesting hauling of missing resource',
            {orderId: order.id, missingAmount, resource: order.resourceType});
          this.haulResourceToTerminal(pickup, order.resourceType, order.remainingAmount - order.amount);
        }
      }

      if (!MARKET.PRICES[order.resourceType]) {
        trace.log(this.id, `no price set for resource`, {resource: order.resourceType, orderId: order.id});
        return;
      }

      let price = MARKET.PRICES[order.resourceType].sell;
      if (order.type === ORDER_BUY) {
        price = MARKET.PRICES[order.resourceType].buy;
      }

      if (order.price !== price) {
        Game.market.changeOrderPrice(order.id, price);
        trace.log(this.id, 'updating order price', {
          orderId: order.id,
          previousPrice: order.price, newPrice: price, resource: order.resource,
        });
      }
    });
  }
  toString() {
    let taskSummary = 'None';
    const task = this.getTask();
    if (task) {
      const taskType = task.details[MEMORY.TERMINAL_TASK_TYPE];
      const orderType = task.details[MEMORY.MEMORY_ORDER_TYPE] || 'NA';
      const roomId = task.details[MEMORY.TRANSFER_ROOM] || 'NA';
      const phase = task.details[MEMORY.TASK_PHASE] || 'NA';
      let resource = task.details[MEMORY.TRANSFER_RESOURCE];
      let amount = task.details[MEMORY.TRANSFER_AMOUNT];


      if (taskType === TASKS.TASK_MARKET_ORDER) {
        resource = task.details[MEMORY.MEMORY_ORDER_RESOURCE];
        amount = task.details[MEMORY.MEMORY_ORDER_AMOUNT];
      }

      taskSummary = `Task Type: ${taskType}, Order Type: ${orderType}, Resource: ${resource}, ` +
        `Amount: ${amount}, Room: ${roomId}, Phase: ${phase} `;
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
  haulResourceToTerminal(pickup, resource, amount) {
    const numHaulers = this.getRoom().getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === resource &&
        creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] === this.terminal.id;
    }).length;

    // If we already have a hauler assigned, don't assign more
    if (numHaulers) {
      return;
    }

    this.doHaulRequest(pickup, resource, amount, 0.8);
  }
  haulTransferEnergyToTerminal(amount, destinationRoom) {
    const energyRequired = Game.market.calcTransactionCost(amount, this.room.name, destinationRoom);
    if (this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < energyRequired) {
      // If we are low on energy don't take any from reserve
      if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) > 20000) {
        const pickup = this.getRoom().getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, false);
        if (!pickup) {
          return false;
        }

        this.doHaulRequest(pickup, RESOURCE_ENERGY, energyRequired, 1);
        return false;
      }

      // console.log(this.getRoom().id, 'does not have energy to send');
      return false;
    }

    return true;
  }
  sendHaulRequest(pickup, resource, amount, priority) {
    amount = _.min([amount, pickup.store.getUsedCapacity(resource)]);

    const details = {
      [MEMORY.TASK_ID]: `mrl-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.terminal.id,
    };

    this.sendRequest(TOPICS.HAUL_CORE_TASK, priority, details, REQUEST_HAUL_RESOURCE_TTL);
  }
  sendEnergyToStorage(amount) {
    const reserve = this.getRoom().getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
    if (!reserve) {
      return;
    }

    const details = {
      [MEMORY.TASK_ID]: `meu-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: this.terminal.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id,
    };
    this.sendRequest(TOPICS.HAUL_CORE_TASK, 0.7, details, REQUEST_RETURN_ENERGY_TTL);
  }
}

module.exports = Terminal;
