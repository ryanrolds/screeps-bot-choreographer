import {PRICES} from "./constants.market";
import * as MEMORY from "./constants.memory";
import * as PRIORITIES from "./constants.priorities";
import * as TASKS from "./constants.tasks";
import * as TOPICS from "./constants.topics";
import {ResourcePricer, SigmoidPricing} from './lib.sigmoid_pricing';
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import {running, sleeping, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getBaseDistributorTopic} from "./topics";

const TASK_PHASE_HAUL_RESOURCE = 'phase_transfer_resource';
const TASK_PHASE_TRANSACT = 'phase_transact';
const TASK_PHASE_TRANSFER = 'phase_transfer';
const TASK_TTL = 50;

const MAX_TERMINAL_ENERGY = 1000;

const PROCESS_TASK_TTL = 10;
const REQUEST_RETURN_ENERGY_TTL = 20;
const ORDER_MGMT_TTL = 1000;
const HAUL_OLD_SELL_ORDER_TTL = 20;
const UPDATE_ENERGY_VALUE_TTL = 2500;

export default class TerminalRunnable {
  baseId: string;
  orgRoom: OrgRoom;
  terminalId: Id<StructureTerminal>;
  prevTime: number;
  processTaskTTL: number;
  returnEnergyTTL: number;
  updateOrdersTTL: number;
  pricer: ResourcePricer;
  energyValue: number;

  threadHaulOldSellOrders: ThreadFunc;
  threadUpdateEnergyValue: ThreadFunc;

  constructor(baseId: string, room: OrgRoom, terminal: StructureTerminal) {
    this.baseId = baseId;
    this.orgRoom = room;

    this.terminalId = terminal.id;
    this.prevTime = Game.time;
    this.processTaskTTL = 0;
    this.returnEnergyTTL = REQUEST_RETURN_ENERGY_TTL;
    this.updateOrdersTTL = ORDER_MGMT_TTL;
    this.pricer = new SigmoidPricing(PRICES);

    this.threadHaulOldSellOrders = thread('haul_old_sell_orders_thread', HAUL_OLD_SELL_ORDER_TTL)(this.haulOldSellOrders.bind(this));
    this.threadUpdateEnergyValue = thread('update_energy_thread', UPDATE_ENERGY_VALUE_TTL)(this.updateEnergyValue.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('terminal_run');

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.processTaskTTL -= ticks;
    this.updateOrdersTTL -= ticks;
    this.returnEnergyTTL -= ticks;

    const terminal = Game.getObjectById(this.terminalId);
    // If terminal no longer exists, terminate
    if (!terminal) {
      trace.log('terminal not found - terminating', {})
      trace.end();
      return terminate();
    }

    if (!terminal.isActive()) {
      trace.end();
      return sleeping(100);
    }

    this.threadHaulOldSellOrders(trace, kingdom, terminal);
    this.threadUpdateEnergyValue(trace);

    let task = terminal.room.memory[MEMORY.TERMINAL_TASK] || null;
    if (!task) {
      this.processTaskTTL = -1;
      task = (this.orgRoom as any).getNextRequest(TOPICS.TOPIC_TERMINAL_TASK);
      if (task) {
        terminal.room.memory[MEMORY.TERMINAL_TASK] = task;
      }
    }

    trace.log('terminal run', {
      ticks,
      processTaskTTL: this.processTaskTTL,
      returnEnergyTTL: this.returnEnergyTTL,
      updateOrdersTTL: this.updateOrdersTTL,
      task,
    })

    if (task && this.processTaskTTL < 0) {
      this.processTaskTTL = PROCESS_TASK_TTL;
      this.processTask(kingdom, terminal, task, ticks, trace);
    } else if (!task) {
      const terminalAmount = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
      if (terminalAmount > MAX_TERMINAL_ENERGY && this.returnEnergyTTL < 0) {
        this.returnEnergyTTL = REQUEST_RETURN_ENERGY_TTL;
        const amountToTransfer = terminalAmount - MAX_TERMINAL_ENERGY;
        trace.log('send energy to storage', {amountToTransfer})
        this.sendEnergyToStorage(kingdom, terminal, amountToTransfer, REQUEST_RETURN_ENERGY_TTL, trace);
      }
    }

    if (this.updateOrdersTTL < 0) {
      this.updateOrdersTTL = ORDER_MGMT_TTL;
      this.updateOrders(terminal, trace);
    }

    trace.end();
    return running();
  }

  isIdle() {
    return !!this.orgRoom.getRoomObject()?.memory[MEMORY.TERMINAL_TASK];
  }
  getTask() {
    return this.orgRoom.getRoomObject()?.memory[MEMORY.TERMINAL_TASK] || null;
  }
  clearTask(trace) {
    trace.log('clearing task');
    delete this.orgRoom.getRoomObject()?.memory[MEMORY.TERMINAL_TASK];
  }

  processTask(kingdom: Kingdom, terminal: StructureTerminal, task, ticks: number, trace: Tracer) {
    const details = task.details;
    const taskType = details[MEMORY.TERMINAL_TASK_TYPE];

    // Maintain task TTL. We want to abort hard to perform tasks
    let ttl = details[MEMORY.TASK_TTL];
    if (ttl === undefined) {
      ttl = TASK_TTL;
    }

    if (ttl < 0) {
      this.clearTask(trace);
      return;
    } else {
      terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_TTL] = ttl - ticks;
    }

    trace.log('processTask', {task})

    switch (taskType) {
      case TASKS.TASK_TRANSFER:
        this.transferResource(kingdom, terminal, details, trace);
        break;
      case TASKS.TASK_MARKET_ORDER:
        // Perform market order
        const orderType = details[MEMORY.MEMORY_ORDER_TYPE];
        if (orderType === ORDER_SELL) {
          this.sell(kingdom, terminal, details, trace);
        } else if (orderType === ORDER_BUY) {
          this.buy(kingdom, terminal, details, trace);
        } else {
          this.clearTask(trace);
        }

        break;
      default:
        this.clearTask(trace);
    }
    return;
  }

  transferResource(kingdom: Kingdom, terminal: StructureTerminal, task, trace: Tracer) {
    const resource = task[MEMORY.TRANSFER_RESOURCE];
    let amount = task[MEMORY.TRANSFER_AMOUNT];
    const roomName = task[MEMORY.TRANSFER_ROOM];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_HAUL_RESOURCE;

    trace.log('transfer resource', {resource, amount, roomName, phase});

    switch (phase) {
      case TASK_PHASE_HAUL_RESOURCE:
        // Check if we should move to next phase
        const terminalAmount = terminal.store.getUsedCapacity(resource);
        if (terminalAmount >= amount) {
          trace.log('terminal amount gte desired amount', {terminalAmount, amount});
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          break;
        }

        const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(resource, false);
        if (!pickup) {
          if (!terminalAmount) {
            trace.log('no pickup and no resources in terminal', {});

            this.clearTask(trace);
            break;
          }

          trace.log('no pickup, but resources in terminal', {terminalAmount});

          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSFER;
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TRANSFER_AMOUNT] = terminalAmount;
          break;
        }

        trace.log('requesting resource transfer to terminal', {pickup: pickup.id, resource, amount});

        this.haulResourceToTerminal(kingdom, terminal, pickup, resource, amount);
        break;
      case TASK_PHASE_TRANSFER:
        let haulAmount = amount;

        const energyRequired = Game.market.calcTransactionCost(amount, terminal.room.name, roomName);
        // If we are transfering energy we need energy in addition to what we want to transfer
        if (resource === RESOURCE_ENERGY) {
          haulAmount += energyRequired;
          trace.log('padded energy', {amount, added: energyRequired});
        }

        const energyReady = this.haulTransferEnergyToTerminal(kingdom, terminal, resource, haulAmount, roomName, trace);
        if (!energyReady) {
          trace.log('energy not ready', {amount, roomName, haulAmount});
          break;
        }

        const result = terminal.send(resource, amount, roomName);
        trace.log('send resource', {resource, amount, roomName, result});
        if (result !== OK) {

        }

        this.clearTask(trace);

        break;
      default:

        this.clearTask(trace);
    }
  }

  buy(kingdom: Kingdom, terminal: StructureTerminal, task, trace: Tracer) {
    const resource = task[MEMORY.MEMORY_ORDER_RESOURCE] as ResourceConstant;
    const amount = task[MEMORY.MEMORY_ORDER_AMOUNT] as number;
    const currentAmount = terminal.store.getUsedCapacity(resource);
    let missingAmount = amount - currentAmount;

    trace.log('buy order', {
      resource,
      amount,
      currentAmount,
      missingAmount,
    });

    // Buy in at least blocks of 1000, to avoid stupid small orders
    missingAmount = Math.max(1000, missingAmount);

    if (currentAmount >= amount) {
      trace.log('buy order satisfied');
      this.clearTask(trace);
      return;
    }

    if (terminal.cooldown) {
      trace.log('buy order failed: cooling down');
      return;
    }

    const orders = Game.market.getAllOrders({type: ORDER_SELL, resourceType: resource});

    const sellOrder = _.sortBy(orders, (order) => {
      const transferEnergy = Game.market.calcTransactionCost(missingAmount, terminal.room.name, order.roomName);
      return order.price + (transferEnergy * this.energyValue);
    })[0];

    const resources = this.orgRoom.getKingdom().getResourceGovernor().getSharedResources();
    const reserveAmount = resources[resource] || 0;

    const maxBuyPrice = this.pricer.getPrice(ORDER_BUY, resource, reserveAmount);
    if (!sellOrder || sellOrder.price > maxBuyPrice) {
      trace.log('sell orders too expensive: creating buy order', {resource, orderPrice: sellOrder?.price, maxBuyPrice});
      this.createBuyOrder(terminal, resource, amount, trace);
      this.clearTask(trace);
      return;
    }

    let dealAmount = Math.min(missingAmount, sellOrder.remainingAmount);
    const energyReady = this.prepareTransferEnergy(kingdom, terminal, sellOrder, dealAmount, trace);
    if (!energyReady) {
      trace.log('deal energy not ready', {dealAmount})
      return;
    }

    const result = Game.market.deal(sellOrder.id, dealAmount, terminal.room.name);
    trace.log('buy deal result', {
      orderId: sellOrder.id,
      dealAmount,
      price: sellOrder.price,
      destRoom: terminal.room.name,
      result
    });
  }

  sell(kingdom: Kingdom, terminal: StructureTerminal, task, trace: Tracer) {
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

            this.clearTask(trace);
            break;
          }


          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.TASK_PHASE] = TASK_PHASE_TRANSACT;
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.MEMORY_ORDER_AMOUNT] = terminalAmount;
          break;
        }

        this.haulResourceToTerminal(kingdom, terminal, pickup, resource, amount);
        break;
      case TASK_PHASE_TRANSACT:
        // Check if we are done selling
        if (terminal.store.getUsedCapacity(resource) === 0 || amount < 1) {
          this.clearTask(trace);
          break;
        }

        // Get lowest buy order
        let buyOrders = Game.market.getAllOrders({type: ORDER_BUY, resourceType: resource});
        buyOrders = buyOrders.filter((order) => {
          return order.remainingAmount > 0;
        });

        const buyOrder = _.sortBy(buyOrders, (order) => {
          const transferEnergy = Game.market.calcTransactionCost(amount, terminal.room.name, order.roomName);
          return order.price + (transferEnergy * this.energyValue);
        }).reverse()[0];

        // Get desired purchase price based on current stockpile
        const resources = this.orgRoom.getKingdom().getResourceGovernor().getSharedResources();
        const currentAmount = resources[resource] || 0;
        const minSellPrice = this.pricer.getPrice(ORDER_SELL, resource, currentAmount);

        // If no buy orders or price is too low, create a sell order
        if (!buyOrder || buyOrder.price < minSellPrice) {
          trace.log('no orders or sell prices too low, creating sell order')
          this.createSellOrder(terminal, resource, amount, trace);
          this.clearTask(trace);
          return;
        }

        // Make sure we have enough energy to perform the deal
        const dealAmount = _.min([amount, buyOrder.remainingAmount]);
        const energyReady = this.prepareTransferEnergy(kingdom, terminal, buyOrder, dealAmount, trace);
        if (!energyReady) {
          trace.log('deal energy not ready', {dealAmount})
          return;
        }

        // If terminal is on cool down, try again in a bit
        if (terminal.cooldown) {
          return;
        }

        // Transact the deal
        const result = Game.market.deal(buyOrder.id, dealAmount, terminal.room.name);
        if (result == OK) {
          trace.log('sold resources', {
            orderId: buyOrder.id,
            dealAmount,
            price: buyOrder.price,
            destRoom: terminal.room.name,
            result
          });

          // deduct amount transacted from total amount we want to buy
          terminal.room.memory[MEMORY.TERMINAL_TASK].details[MEMORY.MEMORY_ORDER_AMOUNT] -= dealAmount;
        }

        break;
      default:
        trace.error('BROKEN MARKET LOGIC', phase);
        this.clearTask(trace);
    }
  }

  prepareTransferEnergy(kingdom: Kingdom, terminal: StructureTerminal, order: Order, amount: number, trace: Tracer) {
    const energyRequired = Game.market.calcTransactionCost(amount, terminal.room.name,
      order.roomName);
    // If we are transfering energy we need energy in addition to what we want to transfer
    let haulAmount = energyRequired;
    if (order.resourceType === RESOURCE_ENERGY) {
      haulAmount = amount + energyRequired;
      trace.log('padded haul amount', {haulAmount, added: energyRequired});
    }

    return this.haulTransferEnergyToTerminal(kingdom, terminal, order.resourceType as ResourceConstant,
      haulAmount, order.roomName, trace);
  }

  createBuyOrder(terminal: StructureTerminal, resource: ResourceConstant, amount: number, trace: Tracer) {
    // Check if we already have a sell order for the room and resource
    const duplicateBuyOrders = Object.values(Game.market.orders).filter((order) => {
      return order.type === ORDER_BUY && order.resourceType === resource &&
        order.roomName === terminal.room.name && order.remainingAmount > 0;
    });
    if (duplicateBuyOrders.length) {
      trace.log('duplicate buy orders found', {duplicateBuyOrders});
      this.clearTask(trace);
      return;
    }

    const buyPrice = this.pricer.getPrice(ORDER_BUY, resource, amount);

    // Create buy order
    const buyOrder = {
      type: ORDER_BUY,
      resourceType: resource,
      price: buyPrice,
      totalAmount: amount,
      roomName: terminal.room.name,
    };
    const result = Game.market.createOrder(buyOrder);
    trace.log('create buy order result', {result, buyOrder})
  }

  createSellOrder(terminal: StructureTerminal, resource: ResourceConstant, amount: number, trace: Tracer) {
    // Check if we already have a sell order for the room and resource
    const duplicateSellOrders = Object.values(Game.market.orders).filter((order) => {
      return order.type === ORDER_SELL && order.resourceType === resource &&
        order.roomName === terminal.room.name && order.remainingAmount > 0;
    });
    if (duplicateSellOrders.length) {
      trace.log('duplicate sell orders found', {duplicateSellOrders});
      this.clearTask(trace);
      return;
    }

    const sellPrice = this.pricer.getPrice(ORDER_SELL, resource, amount);

    // Create buy order
    const order = {
      type: ORDER_SELL,
      resourceType: resource,
      price: sellPrice,
      totalAmount: amount,
      roomName: terminal.room.name,
    };
    const result = Game.market.createOrder(order);
    trace.log('create sell order result', {result, order});
  }

  updateOrders(terminal: StructureTerminal, trace: Tracer) {
    trace.log('updating prices on buy/sell orders');

    Object.values(Game.market.orders).filter((order) => {
      return order.roomName === terminal.room.name;
    }).forEach((order) => {
      if (order.remainingAmount === 0) {
        const result = Game.market.cancelOrder(order.id);
        trace.log('order is complete; cancelled', {result, orderId: order.id});
        return;
      }

      const resources = this.orgRoom.getKingdom().getResourceGovernor().getSharedResources();
      const currentAmount = resources[order.resourceType] || 0;
      const price = this.pricer.getPrice(order.type as (ORDER_BUY | ORDER_SELL),
        order.resourceType as ResourceConstant, currentAmount);
      if (order.price !== price) {
        Game.market.changeOrderPrice(order.id, price);
        trace.log('updating order price', {
          orderId: order.id,
          previousPrice: order.price, newPrice: price, resource: order.resourceType,
        });
      }
    });
  }

  haulOldSellOrders(trace: Tracer, kingdom: Kingdom, terminal: StructureTerminal) {
    trace.log('checking for incomplete sell orders');

    const ordersWithMissingResources = Object.values(Game.market.orders).filter((order) => {
      return order.type === ORDER_SELL && order.roomName === terminal.room.name &&
        order.remainingAmount - order.amount > 0;
    });

    trace.log('incomplete orders', {ordersWithMissingResources})

    ordersWithMissingResources.forEach((order) => {
      const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(order.resourceType, false);
      if (!pickup) {
        const result = Game.market.cancelOrder(order.id);
        trace.log('cancelling order: resource not available', {result, order});
        return;
      }

      const missingAmount = order.remainingAmount - order.amount;
      if (pickup.store.getUsedCapacity(order.resourceType as ResourceConstant) < missingAmount) {
        const result = Game.market.cancelOrder(order.id);
        trace.log('cancelling order: not enough of the resource available', {result, order, missingAmount});
        return;
      }

      trace.log('requesting hauling', {resource: order.resourceType, missingAmount});

      this.sendHaulRequest(kingdom, terminal, pickup, order.resourceType as ResourceConstant, missingAmount, PRIORITIES.HAUL_TERMINAL);
    });
  }

  haulResourceToTerminal(kingdom: Kingdom, terminal: StructureTerminal, pickup, resource, amount) {
    const baseCreeps = kingdom.creepManager.getCreepsByBase(this.baseId);
    const numHaulers = baseCreeps.filter((creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.TASK_HAUL &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === resource &&
        creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] === terminal.id;
    }).length;

    // If we already have a hauler assigned, don't assign more
    if (numHaulers) {
      return;
    }

    this.sendHaulRequest(kingdom, terminal, pickup, resource, amount, PRIORITIES.HAUL_TERMINAL);
  }

  haulTransferEnergyToTerminal(kingdom: Kingdom, terminal: StructureTerminal, resource: ResourceConstant,
    amount: number, destinationRoom: string, trace: Tracer) {
    const currentEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
    if (currentEnergy < amount) {
      // If we are low on energy don't take any from reserve
      if (this.orgRoom.getAmountInReserve(RESOURCE_ENERGY) > 20000) {
        const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, false);
        if (!pickup) {
          return false;
        }

        const requestAmount = amount - currentEnergy;
        trace.log('requesting', {resource, amount: requestAmount});
        this.sendHaulRequest(kingdom, terminal, pickup, RESOURCE_ENERGY, requestAmount, PRIORITIES.HAUL_TERMINAL);
        return false;
      }

      return false;
    }

    return true;
  }

  sendHaulRequest(kingdom: Kingdom, terminal: StructureTerminal, pickup: AnyStoreStructure, resource: ResourceConstant, amount: number, priority: number) {
    amount = _.min([amount, pickup.store.getUsedCapacity(resource)]);

    const details = {
      [MEMORY.TASK_ID]: `mrl-${terminal.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: terminal.id,
    };

    kingdom.sendRequest(getBaseDistributorTopic(this.baseId), priority, details, PROCESS_TASK_TTL);
  }

  sendEnergyToStorage(kingdom: Kingdom, terminal: StructureTerminal, amount: number, ttl: number, trace: Tracer) {
    const reserve = this.orgRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
    if (!reserve) {
      trace.log('could not find dropoff for energy', {amount});
      return;
    }

    trace.log('sending request to haul energy from terminal', {amount, dropoff: reserve.id});

    const details = {
      [MEMORY.TASK_ID]: `meu-${terminal.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: terminal.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id,
    };

    kingdom.sendRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_TERMINAL, details, ttl);
  }

  updateEnergyValue(trace: Tracer) {
    const energyHistory = Game.market.getHistory(RESOURCE_ENERGY)
    trace.log('updating energy value', {energyHistory});

    // private servers can return energyHistory as an empty object
    if (!energyHistory || !Array.isArray(energyHistory) || !energyHistory.length) {
      this.energyValue = 1;
      return;
    }

    const dailyAvgs = energyHistory.map(order => order.avgPrice);
    if (!dailyAvgs.length) {
      this.energyValue = 1;
      return;
    }

    this.energyValue = _.sum(dailyAvgs) / dailyAvgs.length;
  }
}

