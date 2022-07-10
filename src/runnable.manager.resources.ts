import {Base, getBasePrimaryRoom, getStoredResourceAmount, getStoredResources, ResourceCounts} from './base';
import {PRICES} from './constants.market';
import {MEMORY_ORDER_AMOUNT, MEMORY_ORDER_RESOURCE, MEMORY_ORDER_TYPE, REACTOR_AMOUNT, REACTOR_INPUT_A, REACTOR_INPUT_B, REACTOR_OUTPUT, REACTOR_TASK_TYPE, TERMINAL_TASK_TYPE, TRANSFER_AMOUNT, TRANSFER_RESOURCE, TRANSFER_ROOM} from './constants.memory';
import {REACTION_PRIORITIES, TERMINAL_BUY, TERMINAL_SELL, TERMINAL_TRANSFER} from './constants.priorities';
import {REACTION, TASK_MARKET_ORDER, TASK_TRANSFER} from './constants.tasks';
import {TASK_REACTION, TOPIC_TERMINAL_TASK} from './constants.topics';
import {Kernel} from './kernel';
import {Consumer} from './lib.event_broker';
import {SigmoidPricing} from './lib.sigmoid_pricing';
import {Tracer} from './lib.tracing';
import {running} from './os.process';
import {Runnable, RunnableResult} from './os.runnable';
import {thread, ThreadFunc} from './os.thread';
import {Reaction, ReactionMap} from './runnable.base_booster';
import {REACTION_STATUS_STREAM} from './runnable.base_reactor';

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
const MIN_CRITICAL_COMPOUND_RALLY = 5000;
const CRITICAL_EFFECTS = {
  'upgradeController': ['XGH2O', 'GH2O', 'GH'],
  // 'capacity': ['XKH2O', 'KH2O', 'KH'],
  'heal': ['XLHO2', 'LHO2', 'LO'],
  'attack': ['XUH2O', 'UH2O', 'UH'],
  'rangedAttack': ['XKHO2', 'KHO2', 'KO'],
  'damage': ['XGHO2', 'GHO2', 'GO'],
  'dismantle': ['XZH2O', 'ZH2O', 'ZH'],
};

export class ResourceManager implements Runnable {
  private pricer: SigmoidPricing;
  private resources: ResourceCounts;
  private sharedResources: ResourceCounts;

  private availableReactions = {};
  private reactorStatuses = [];
  private roomStatuses = [];
  private reactionStats = {};
  private reactionStatuses = {};
  private reactionStatusStreamConsumer: Consumer;

  private threadUpdateResources: ThreadFunc;
  private threadRequestReactions: ThreadFunc;
  private threadRequestSellExtraResources: ThreadFunc;
  private threadDistributeBoosts: ThreadFunc;
  private threadConsumeStatuses: ThreadFunc;
  private threadConsumeReactionStatusStream: ThreadFunc;
  private threadBalanceEnergy: ThreadFunc;

  constructor(kernel: Kernel) {
    this.pricer = new SigmoidPricing(PRICES);
    this.resources = {};
    this.sharedResources = {};
    this.availableReactions = {};
    this.reactorStatuses = [];
    this.roomStatuses = [];
    this.reactionStats = {};
    this.reactionStatuses = {};

    this.reactionStatusStreamConsumer = kernel.getBroker().
      getStream(REACTION_STATUS_STREAM).addConsumer('resource_governor');

    this.threadUpdateResources = thread('update_resources_thread', UPDATE_RESOURCES_TTL)((trace: Tracer, kernel: Kernel) => {
      this.resources = this.getBaseResources(kernel);
      this.sharedResources = this.getSharedResources(kernel);
    });

    this.threadRequestReactions = thread('request_reactions_thread', REQUEST_REACTION_TTL)((trace: Tracer, kernel: Kernel) => {
      this.availableReactions = this.getReactions(kernel, trace);
      this.requestReactions(trace, kernel);
    });

    this.threadRequestSellExtraResources = thread('request_sell_resources_tread', REQUEST_SELL_TTL)((trace: Tracer, kernel: Kernel) => {
      this.requestSellResource(trace, kernel);
    });

    this.threadDistributeBoosts = thread('distribute_boosts_thread', REQUEST_DISTRIBUTE_BOOSTS)((trace: Tracer, kernel: Kernel) => {
      this.distributeBoosts(trace, kernel);
    });

    this.threadConsumeStatuses = thread('statuses_thread', CONSUME_STATUS_TTL)(this.consumeStatuses.bind(this));
    this.threadConsumeReactionStatusStream = thread('reaction_stream',
      CONSUME_STATUS_TTL)(this.consumeReactionStatusStream.bind(this));
    this.threadBalanceEnergy = thread('balance_energy_thread',
      BALANCE_ENERGY_TTL)(this.balanceEnergy.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    this.threadUpdateResources(trace, kernel);
    this.threadRequestReactions(trace, kernel);
    this.threadRequestSellExtraResources(trace, kernel);
    this.threadDistributeBoosts(trace, kernel);
    this.threadConsumeStatuses(trace, kernel);
    this.threadConsumeReactionStatusStream(trace, kernel);
    this.threadBalanceEnergy(trace, kernel);

    return running();
  }

  getRoomWithTerminalWithResource(kernel: Kernel, resource: ResourceConstant, notRoomName: Id<Room> = null) {
    const terminals = kernel.getPlanner().getBases().reduce((acc, base) => {
      const room = getBasePrimaryRoom(base);
      if (!room) {
        return acc;
      }

      // Don't return the room needing the resources
      if (notRoomName && room.name === notRoomName) {
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

      let amount = getStoredResourceAmount(base, resource);

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

  getTerminals(kernel: Kernel): StructureTerminal[] {
    return kernel.getPlanner().getBases().reduce((acc, base) => {
      const room = getBasePrimaryRoom(base);
      if (!room) {
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!room.terminal) {
        return acc;
      }

      return acc.concat(room.terminal);
    }, [] as StructureTerminal[]);
  }

  getSharedResources(kernel: Kernel): ResourceCounts {
    return kernel.getPlanner().getBases().reduce((acc, base) => {
      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        return acc;
      }

      if (!primaryRoom.terminal) {
        return acc;
      }

      const baseResources = getStoredResources(base);
      Object.keys(baseResources).forEach((resource) => {
        // Find first effect for that resource
        const isCritical = Object.values(CRITICAL_EFFECTS).find((compounds) => {
          if (compounds.indexOf(resource) != -1) {
            return true;
          }
          return false;
        }, false);

        // If critical, subtract min compound amount
        let amount = baseResources[resource];
        if (isCritical) {
          amount -= MIN_CRITICAL_COMPOUND;
        }
        if (amount < 0) {
          amount = 0;
        }

        // Update the resource counts
        const current = acc[resource] || 0;
        acc[resource] = amount + current;
      });

      return acc;
    }, {} as ResourceCounts);
  }

  getBaseResources(kernel: Kernel): ResourceCounts {
    return kernel.getPlanner().getBases().reduce((acc, base) => {
      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        return acc;
      }

      if (!primaryRoom.terminal) {
        return acc;
      }

      const baseResources = getStoredResources(base);
      Object.keys(baseResources).forEach((resource) => {
        const current = acc[resource] || 0;
        acc[resource] = baseResources[resource] + current;
      });

      return acc;
    }, {} as ResourceCounts);
  }

  getAmountInReserve(kernel: Kernel, resource): number {
    return kernel.getPlanner().getBases().reduce((acc, base) => {
      return acc + getStoredResourceAmount(base, resource);
    }, 0);
  }

  getReactions(kernel: Kernel, trace: Tracer): Reaction[] {
    const availableReactions: ReactionMap = {};
    const missingOneInput: ReactionMap = {};
    const overReserve: ReactionMap = {};

    const firstInputs = Object.keys(REACTIONS);
    firstInputs.forEach((inputA) => {
      // If we don't have a full batch, move onto next
      if (!this.resources[inputA] || this.resources[inputA] < REACTION_BATCH_SIZE) {
        trace.info('dont have enough of first resource', {
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
          trace.info('adding available reaction', {
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

    const sortedAvailableReactions = this.prioritizeReactions(availableReactions, 0);
    const sortedMissingOneInput = this.prioritizeReactions(missingOneInput, 5);
    // overReserve = this.prioritizeReactions(overReserve, 10);

    let nextReactions: Reaction[] = [].concat(sortedAvailableReactions);
    if (Object.keys(missingOneInput).length && Game.market.credits > MIN_CREDITS) {
      nextReactions = nextReactions.concat(sortedMissingOneInput);
    }
    // nextReactions = nextReactions.concat(overReserve.reverse());

    trace.info('available reactions', {nextReactions, availableReactions, missingOneInput, overReserve});

    return nextReactions;
  }

  prioritizeReactions(reactions: ReactionMap, penalty: number): Reaction[] {
    return _.sortBy(Object.values(reactions), (reaction) => {
      let priority = REACTION_PRIORITIES[reaction['output']];

      // Reduce priority linearly based on amount of resource (more = lower priority)
      const amount = this.resources[reaction['output']] || 0;
      priority = priority * _.max([0, 1 - (amount / RESERVE_LIMIT)]);
      priority -= penalty;

      reaction['priority'] = priority;

      return priority;
    });
  }

  buyResource(kernel: Kernel, base: Base, resource: ResourceCounts, amount: number, ttl: number, trace: Tracer) {
    trace.info('requesting resource purchase', {baseId: base.id, resource, amount, ttl});

    const primaryRoom = getBasePrimaryRoom(base);
    if (!primaryRoom) {
      trace.info('no primary room', {baseId: base.id});
      return;
    }

    // We can't request a transfer if room lacks a terminal
    if (!primaryRoom.terminal) {
      trace.info('room does not have a terminal', {baseId: base.id});
      return false;
    }

    const details = {
      [TERMINAL_TASK_TYPE]: TASK_MARKET_ORDER,
      [MEMORY_ORDER_TYPE]: ORDER_BUY,
      [MEMORY_ORDER_RESOURCE]: resource,
      [MEMORY_ORDER_AMOUNT]: amount,
    };

    if (Game.market.credits < MIN_CREDITS) {
      trace.info('below min credits, not purchasing resource', {resource, amount});
      return false;
    }

    trace.info('purchase resource', {baseId: base.id, resource, amount});
    kernel.getTopics().addRequest(TOPIC_TERMINAL_TASK, TERMINAL_BUY, details, ttl);

    return true;
  }

  requestResource(kernel: Kernel, base: Base, room, resource, amount, ttl, trace) {
    trace.log('requesting resource transfer', {baseId: base.id, resource, amount, ttl});

    // We can't request a transfer if room lacks a terminal
    if (!room.hasTerminal()) {
      trace.log('room does not have a terminal', {baseId: base.id});
      return false;
    }

    // Don't send transfer request if a terminal already has the task
    const inProgress = this.getTerminals(kernel).filter((orgTerminal) => {
      const task = orgTerminal.getTask();
      if (!task) {
        return false;
      }

      return task.details[TRANSFER_RESOURCE] === resource &&
        task.details[TRANSFER_ROOM] === room.id;
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

    result.room.sendRequest(TOPIC_TERMINAL_TASK, TERMINAL_TRANSFER, {
      [TERMINAL_TASK_TYPE]: TASK_TRANSFER,
      [TRANSFER_RESOURCE]: resource,
      [TRANSFER_AMOUNT]: amount,
      [TRANSFER_ROOM]: room.id,
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

  requestReactions(trace: Tracer, kernel: Kernel) {
    Object.values(this.availableReactions).forEach((reaction) => {
      const details = {
        [REACTOR_TASK_TYPE]: REACTION,
        [REACTOR_INPUT_A]: reaction['inputA'],
        [REACTOR_INPUT_B]: reaction['inputB'],
        [REACTOR_OUTPUT]: reaction['output'],
        [REACTOR_AMOUNT]: REACTION_BATCH_SIZE,
      };

      kernel.getTopics().addRequest(TASK_REACTION, reaction['priority'], details, REQUEST_REACTION_TTL);
    });

    const reactions = kernel.getTopics().getTopic(TASK_REACTION);
    if (!reactions || !reactions.length) {
      trace.log('no reactions to request');
      return;
    }

    trace.log('requested reactions', {
      reactions: reactions.map((r) => {
        return {
          output: r.details[REACTOR_OUTPUT],
          priority: r.priority,
        };
      }),
    });
  }

  requestSellResource(trace: Tracer, kernel: Kernel) {
    const entries = Object.entries(this.sharedResources);

    this.sharedResources.forEach((amount, resource) => {
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

      const result = this.getRoomWithTerminalWithResource(kernel, resource);
      if (!result) {
        return;
      }

      const sellAmount = _.min([result.amount, excess, MAX_SELL_AMOUNT]);

      const details = {
        [TERMINAL_TASK_TYPE]: TASK_MARKET_ORDER,
        [MEMORY_ORDER_TYPE]: ORDER_SELL,
        [MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY_ORDER_AMOUNT]: sellAmount,
      };

      result.room.sendRequest(TOPIC_TERMINAL_TASK, TERMINAL_SELL,
        details, REQUEST_SELL_TTL);
    });
  }

  distributeBoosts(trace: Tracer, kernel: Kernel) {
    trace.log('balancing boosts');

    kernel.getPlanner().getBases().forEach((base) => {
      const baseTrace = trace.withFields({base: base.id});
      const baseEnd = baseTrace.startTimer('colony');

      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        baseEnd();
        return;
      }

      const room = primaryRoom.getRoomObject();
      if (!room || !room.terminal || !room.storage) {
        baseEnd();
        return;
      }

      const boosterPos = primaryRoom.getBoosterPosition();
      if (!boosterPos) {
        baseEnd();
        return;
      }

      // PREDICTION not checking that the labs are still valid because of the hack
      // in runnable.labs that sets orgRoom.booster when creating the process
      // will bite me, you're welcome future Ryan

      const allEffects = primaryRoom.getAllEffects();
      const availableEffects = primaryRoom.getLoadedEffects();
      const rallyFlagRoom = Game.flags['rally']?.pos.roomName;

      Object.entries(CRITICAL_EFFECTS).forEach(([effectName, compounds]) => {
        const effectTrace = baseTrace.withFields({
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
            colonyId: base.id,
            bestCompound,
            currentAmount,
            credits: Game.market.credits,
            MIN_CRITICAL_COMPOUND,
          });

          let minimumCritical = MIN_CRITICAL_COMPOUND;
          if (primaryRoom === rallyFlagRoom) {
            minimumCritical = MIN_CRITICAL_COMPOUND_RALLY;
          }

          const requested = this.requestResource(kernel, base, primaryRoom, bestCompound, minimumCritical - currentAmount,
            REQUEST_DISTRIBUTE_BOOSTS, effectTrace);

          // If we couldnt request resource, try buying
          if (!requested && Game.market.credits > MIN_BOOST_CREDITS) {
            this.buyResource(primaryRoom, bestCompound, minimumCritical - currentAmount,
              REQUEST_DISTRIBUTE_BOOSTS, effectTrace);
          }
        } else {
          effectTrace.log('have booster', {colonyId: base.id, effectName, bestCompound, currentAmount});
        }

        effectsEnd();
      });

      baseEnd();
    });
  }

  consumeReactionStatusStream(trace) {
    const events = this.reactionStatusStreamConsumer.getEvents();

    trace.log('reaction status events', {events});

    events.forEach((event) => {
      switch (event.type) {
        case REACTION_STATUS_START:
        case REACTION_STATUS_UPDATE:
          this.reactionStatuses[event.key] = event.data;
          break;
        case REACTION_STATUS_STOP:
          delete this.reactionStatuses[event.key];
          break;
        default:
          throw new Error(`Unknown reaction status event type: ${event.type}`);
      }
    });
  }

  consumeStatuses(trace: Tracer, kernel: Kernel) {
    trace.log('consuming statues');

    const reactorStatuses = kernel.getTopics().getTopic(ACTIVE_REACTIONS) || [];
    this.reactorStatuses = reactorStatuses;
    trace.log('reactor statuses', {length: reactorStatuses.length});

    this.reactionStats = reactorStatuses.reduce((acc, status) => {
      const resource = status.details[REACTION_STATUS_RESOURCE];
      if (!acc[resource]) {
        acc[resource] = 0;
      }

      const phase = status.details[REACTION_STATUS_PHASE];
      if (phase === TASK_PHASE_REACT) {
        acc[resource] += 1;
      }

      return acc;
    }, {});

    const roomStatuses = kernel.getTopics().getTopic(ROOM_STATUES) || [];
    this.roomStatuses = roomStatuses;
    trace.log('room statuses', {length: roomStatuses.length});
  }

  balanceEnergy(trace: Tracer, kernel: Kernel) {
    if (this.roomStatuses.length < 2) {
      trace.log('not enough rooms to balance');
      return;
    }

    const hasTerminals: RoomStatus[] = _.filter(this.roomStatuses, {details: {[ROOM_STATUS_TERMINAL]: true}});
    if (hasTerminals.length < 2) {
      trace.log('not enough terminals to balance');
      return;
    }

    const energySorted = _.sortByAll(hasTerminals, [
      ['details', ROOM_STATUS_ENERGY].join('.'),
    ]);
    const levelAndEnergySorted = _.sortByAll(hasTerminals, [
      ['details', ROOM_STATUS_LEVEL].join('.'),
      ['details', ROOM_STATUS_LEVEL_COMPLETED].join('.'),
      ['details', ROOM_STATUS_ENERGY].join('.'),
    ]);

    trace.log('sorted', {energySorted, levelAndEnergySorted});

    const sinkRoom = levelAndEnergySorted[0];
    const sourceRoom = energySorted[energySorted.length - 1];

    if (sinkRoom === sourceRoom) {
      trace.log('sink and source are same');
      return;
    }

    const energyDiff = sourceRoom.details[ROOM_STATUS_ENERGY] - sinkRoom.details[ROOM_STATUS_ENERGY];
    if (energyDiff < ENERGY_BALANCE_AMOUNT * 2) {
      trace.log('energy different too small, no need to send energy', {energyDiff});
      return;
    }

    const sourceRoomName = sourceRoom.details[ROOM_STATUS_NAME];
    const sinkRoomName = sinkRoom.details[ROOM_STATUS_NAME];
    const request = {
      [TERMINAL_TASK_TYPE]: TASK_TRANSFER,
      [TRANSFER_RESOURCE]: RESOURCE_ENERGY,
      [TRANSFER_AMOUNT]: ENERGY_BALANCE_AMOUNT,
      [TRANSFER_ROOM]: sinkRoomName,
    };

    trace.notice('send energy request', {request});

    kernel.getTopics().addRequest(TOPIC_TERMINAL_TASK, TERMINAL_ENERGY_BALANCE,
      request, BALANCE_ENERGY_TTL);
  }
}
