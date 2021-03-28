import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as MARKET from "./constants.market"

const TASK_PHASE_HAUL_RESOURCE = 'phase_transfer_resource';
const TASK_PHASE_TRANSACT = 'phase_transact';
const TASK_PHASE_TRANSFER = 'phase_transfer';
const TASK_TTL = 100;

const MAX_TERMINAL_ENERGY = 10000;

const PROCESS_TASK_TTL = 20;
const REQUEST_RETURN_ENERGY_TTL = 20;
const ORDER_MGMT_TTL = 55;


export default class TerminalRunnable {
  orgRoom: OrgRoom;
  terminalId: Id<StructureTerminal>;
  prevTime: number;
  processTaskTTL: number;
  returnEnergyTTL: number;
  updateOrdersTTL: number;

  constructor(room: OrgRoom, terminal: StructureTerminal) {
    this.orgRoom = room;

    this.terminalId = terminal.id;
    this.prevTime = Game.time;
    this.processTaskTTL = 0;
    this.returnEnergyTTL = REQUEST_RETURN_ENERGY_TTL;
    this.updateOrdersTTL = ORDER_MGMT_TTL;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.processTaskTTL -= ticks;
    this.updateOrdersTTL -= ticks;
    this.returnEnergyTTL -= ticks;

    const terminal = Game.getObjectById(this.terminalId);
    // If terminal no longer exists, terminate
    if (!terminal) {
      trace.log(this.terminalId, 'terminal not found - terminating', {})
      return terminate();
    }

    let task = terminal.room.memory[MEMORY.TERMINAL_TASK] || null;
    if (!task) {
      this.processTaskTTL = -1;
      task = (this.orgRoom as any).getNextRequest(TOPICS.TOPIC_TERMINAL_TASK);
      if (task) {
        this.processTaskTTL = PROCESS_TASK_TTL;
        terminal.room.memory[MEMORY.TERMINAL_TASK] = task;
      }
    }

    trace.log(this.terminalId, 'terminal run', {
      ticks,
      processTaskTTL: this.processTaskTTL,
      returnEnergyTTL: this.returnEnergyTTL,
      updateOrdersTTL: this.updateOrdersTTL,
      task,
    })

    if (task && this.processTaskTTL < 0) {
      this.processTask(terminal, task, ticks, trace);
    }

    const terminalAmount = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    if (terminalAmount > MAX_TERMINAL_ENERGY && this.returnEnergyTTL < 0) {
      this.sendEnergyToStorage(terminal, terminalAmount - MAX_TERMINAL_ENERGY);
    }

    if (this.updateOrdersTTL < 0) {
      this.updateOrders(terminal, trace);
    }

    return running();
  }

  isIdle() {
    return !!this.orgRoom.getRoomObject()?.memory[MEMORY.TERMINAL_TASK];
  }
  getTask() {
    return this.orgRoom.getRoomObject()?.memory[MEMORY.TERMINAL_TASK] || null;
  }
  clearTask() {
    delete this.orgRoom.getRoomObject()?.memory[MEMORY.TERMINAL_TASK];
  }

  processTask(terminal: StructureTerminal, task, ticks: number, trace: Tracer) {
    const details = task.details;
    const taskType = details[MEMORY.TERMINAL_TASK_TYPE];

    trace.log(this.terminalId, 'processTask', {task})

    switch (taskType) {
      case TASKS.TASK_TRANSFER:
        this.transferResource(terminal, details, trace);
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
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_TTL] = ttl - ticks;
        }

        // Perform market order
        const orderType = details[MEMORY.MEMORY_ORDER_TYPE];
        if (orderType === ORDER_SELL) {
          this.sell(terminal, details);
        } else if (orderType === ORDER_BUY) {
          this.buy(terminal, details);
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

  transferResource(terminal: StructureTerminal, task, trace: Tracer) {
    const resource = task[MEMORY.TRANSFER_RESOURCE];
    const amount = task[MEMORY.TRANSFER_AMOUNT];
    const roomId = task[MEMORY.TRANSFER_ROOM];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    trace.log(this.terminalId, 'transfer resource', {resource, amount, roomId, phase});

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        const terminalAmount = terminal.store.getUsedCapacity(resource);
        if (terminalAmount >= amount) {
          trace.log(this.terminalId, 'terminal amount gte desired amount', {terminalAmount, amount});
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          break;
        }

        const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(resource, false);
        if (!pickup) {
          if (!terminalAmount) {
            trace.log(this.terminalId, 'no pickup and no resources in terminal', {});

            this.clearTask();
            break;
          }

          trace.log(this.terminalId, 'no pickup, but resources in terminal', {terminalAmount});

          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TRANSFER_AMOUNT] = terminalAmount;
          break;
        }

        trace.log(this.terminalId, 'requesting resource transfer to terminal', {pickup: pickup.id, resource, amount});

        this.haulResourceToTerminal(terminal, pickup, resource, amount);
        break;
      case TASK_PHASE_TRANSFER:
        const energyReady = this.haulTransferEnergyToTerminal(terminal, amount, roomId);
        if (!energyReady) {
          trace.log(this.terminalId, 'energy not ready', {amount, roomId});
          break;
        }

        const result = terminal.send(resource, amount, roomId);

        trace.log(this.terminalId, 'sending', {resource, amount, roomId, result});

        if (result !== OK) {
          // console.log("problem sending resource", terminalId, resource, amount, roomId, result)
        }

        this.clearTask();

        break;
      default:
        // console.log('BROKEN MARKET LOGIC', phase);
        this.clearTask();
    }
  }

  buy(terminal: StructureTerminal, task) {
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE];
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT];
    const currentAmount = terminal.store.getUsedCapacity(resource);
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
    const energyReady = this.haulTransferEnergyToTerminal(terminal, dealAmount, order.roomName);
    if (!energyReady) {
      return;
    }

    if (terminal.cooldown) {
      return;
    }

    Game.market.deal(order.id, dealAmount, terminal.room.name);
  }

  sell(terminal: StructureTerminal, task) {
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE];
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        const terminalAmount = terminal.store.getUsedCapacity(resource);
        if (terminalAmount >= amount) {
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSACT;
          break;
        }

        const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(resource, false);
        if (!pickup) {
          if (!terminalAmount) {
            // console.log('clearing task no pickup and no terminal amount');
            this.clearTask();
            break;
          }

          // console.log(`no pickup locations for ${resource}, using terminal amount`);
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSACT;
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.MEMORY_ORDER_AMOUNT] = terminalAmount;
          break;
        }

        this.haulResourceToTerminal(terminal, pickup, resource, amount);
        break;
      case TASK_PHASE_TRANSACT:
        // Check if we are done selling
        if (terminal.store.getUsedCapacity(resource) === 0 || amount < 1) {
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
              order.roomName === terminal.room.name && order.remainingAmount > 0;
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
            roomName: terminal.room.name,
          };
          const result = Game.market.createOrder(order);
          if (result != OK) {
            // console.log(`problem creating sell order ${result}: ${JSON.stringify(order)}`)
          }

          this.clearTask();
          return;
        }

        const dealAmount = _.min([amount, order.remainingAmount]);
        const energyReady = this.haulTransferEnergyToTerminal(terminal, dealAmount, order.roomName);
        if (!energyReady) {
          return;
        }

        if (terminal.cooldown) {
          return;
        }

        const result = Game.market.deal(order.id, dealAmount, terminal.room.name);
        // console.log(`tried to sell ${dealAmount} of ${resource} - result ${result}`);
        if (result == OK) {
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.MEMORY_ORDER_AMOUNT] -= dealAmount;
        }

        break;
      default:
        console.log('BROKEN MARKET LOGIC', phase);
        this.clearTask();
    }
  }

  updateOrders(terminal: StructureTerminal, trace: Tracer) {
    // Check if we already have a sell order for the room and resource
    Object.values(Game.market.orders).filter((order) => {
      return order.roomName === terminal.room.name;
    }).forEach((order) => {
      if (order.remainingAmount === 0) {
        trace.log(this.terminalId, 'order is complete; cancelling', {orderId: order.id});
        Game.market.cancelOrder(order.id);
        return;
      }

      const missingAmount = order.amount - order.remainingAmount;
      if (missingAmount > 0) {
        const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(order.resourceType, false);
        if (!pickup) {
          trace.log(this.terminalId, 'order missing resource and no pickup; cancelling',
            {orderId: order.id, missingAmount, resource: order.resourceType});
          Game.market.cancelOrder(order.id);
        } else {
          trace.log(this.terminalId, 'requesting hauling of missing resource',
            {orderId: order.id, missingAmount, resource: order.resourceType});
          this.haulResourceToTerminal(terminal, pickup, order.resourceType, order.remainingAmount - order.amount);
        }
      }

      if (!MARKET.PRICES[order.resourceType]) {
        trace.log(this.terminalId, `no price set for resource`, {resource: order.resourceType, orderId: order.id});
        return;
      }

      let price = MARKET.PRICES[order.resourceType].sell;
      if (order.type === ORDER_BUY) {
        price = MARKET.PRICES[order.resourceType].buy;
      }

      if (order.price !== price) {
        Game.market.changeOrderPrice(order.id, price);
        trace.log(this.terminalId, 'updating order price', {
          orderId: order.id,
          previousPrice: order.price, newPrice: price, resource: order.resourceType,
        });
      }
    });
  }

  haulResourceToTerminal(terminal: StructureTerminal, pickup, resource, amount) {
    const numHaulers = this.orgRoom.getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === resource &&
        creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] === terminal.id;
    }).length;

    // If we already have a hauler assigned, don't assign more
    if (numHaulers) {
      return;
    }

    this.sendHaulRequest(terminal, pickup, resource, amount, 0.8);
  }

  haulTransferEnergyToTerminal(terminal: StructureTerminal, amount: number, destinationRoom: string) {
    const energyRequired = Game.market.calcTransactionCost(amount, terminal.room.name, destinationRoom);
    if (terminal.store.getUsedCapacity(RESOURCE_ENERGY) < energyRequired) {
      // If we are low on energy don't take any from reserve
      if (this.orgRoom.getAmountInReserve(RESOURCE_ENERGY) > 20000) {
        const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, false);
        if (!pickup) {
          return false;
        }

        this.sendHaulRequest(terminal, pickup, RESOURCE_ENERGY, energyRequired, 1);
        return false;
      }

      // console.log(this.orgRoom.id, 'does not have energy to send');
      return false;
    }

    return true;
  }

  sendHaulRequest(terminal: StructureTerminal, pickup: AnyStoreStructure, resource: ResourceConstant, amount: number, priority: number) {
    amount = _.min([amount, pickup.store.getUsedCapacity(resource)]);

    const details = {
      [MEMORY.TASK_ID]: `mrl-${terminal.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: terminal.id,
    };

    (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, priority, details, PROCESS_TASK_TTL);
  }

  sendEnergyToStorage(terminal: StructureTerminal, amount) {
    const reserve = this.orgRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
    if (!reserve) {
      return;
    }

    const details = {
      [MEMORY.TASK_ID]: `meu-${terminal.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: terminal.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id,
    };
    (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, 0.7, details, PROCESS_TASK_TTL);
  }
}
