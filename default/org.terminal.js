const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');

class Terminal extends OrgBase {
  constructor(parent, terminal) {
    super(parent, terminal.id);

    this.terminal = terminal;
    this.room = parent.getRoomObject();
  }
  update() {
    console.log(this);

    const task = this.room.memory[MEMORY.TERMINAL_TASK];
    if (task) {
      const details = task.details;
      switch (task.details[MEMORY.TERMINAL_TASK_TYPE]) {
        case TASKS.TASK_TRANSFER:
          this.transferResource(details);
          break;
        case TASKS.TASK_MARKET_ORDER:
          this.marketOrder(details);
          break;
      }
    } else {
      // If reserve is low then transfer engery back
      if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) < 2000 &&
        this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        const reserve = this.getRoom().getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
        if (!reserve) {
          return;
        }

        const details = {
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
          [MEMORY.MEMORY_HAUL_PICKUP]: this.terminal.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
          [MEMORY.MEMORY_HAUL_AMOUNT]: 1000,
          [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id,
        };
        this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details);
      }
    }
  }
  process() {
    // console.log(JSON.stringify(this.terminal))

    if (!this.room.memory[MEMORY.TERMINAL_TASK]) {
      const task = this.getNextRequest(TOPICS.TOPIC_TERMINAL_TASK);
      if (task) {

        this.room.memory[MEMORY.TERMINAL_TASK] = task;
      }
    }
  }
  transferResource(task) {

  }
  marketOrder(task) {
    const orderType = task[MEMORY.MEMORY_ORDER_TYPE];
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE];
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT];

    if (this.terminal.store.getUsedCapacity(resource) < amount) {
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
        return;
      }

      const details = {
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
        [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
        [MEMORY.MEMORY_HAUL_DROPOFF]: this.terminal.id,
      };

      this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details);

      return;
    }

    let marketOrderType = null;
    if (orderType === ORDER_SELL) {
      marketOrderType = ORDER_BUY;
    } else if (orderType === ORDER_BUY) {
      marketOrderType = ORDER_SELL;
    }

    let orders = Game.market.getAllOrders({type: marketOrderType, resourceType: resource});
    if (!orders.length) {
      console.log('Market - no orders for', orderType, resource, amount);
      return;
    }

    orders = _.sortBy(orders, 'price').reverse();

    console.log('orders', JSON.stringify(orders));

    const order = orders[0];

    if (order.price < 0.2) {
      return;
    }

    const dealAmount = Math.min(amount, order.remainingAmount);
    const energyRequired = Game.market.calcTransactionCost(dealAmount, this.room.name, order.roomName);
    console.log('energy required', energyRequired, dealAmount, this.room.name, order.roomName);

    if (this.terminal.store.getUsedCapacity(RESOURCE_ENERGY) < energyRequired) {
      const reserve = this.getRoom().getReserveStructureWithMostOfAResource(resource);
      if (!reserve) {
        return;
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

        console.log('terminal energy haul', JSON.stringify(details));

        this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 1, details);
      } else {
        console.log(this.getRoom().id, 'does not have energy to spare for selling minerals');
      }

      return;
    }

    if (this.terminal.cooldown) {
      return;
    }

    const result = Game.market.deal(order.id, dealAmount, this.room.name);
    console.log('deal', result);

    if (result == OK) {

    }
  }
  toString() {
    return `-- Terminal`;
  }
  updateStats() { }
}

module.exports = Terminal;
