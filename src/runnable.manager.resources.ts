import {
  Base, getBasePrimaryRoom, getStoredEffects, getStoredResourceAmount,
  getStoredResources, ResourceCounts
} from './base';
import {PRICES} from './constants.market';
import {
  BASE_STATUS_ENERGY, BASE_STATUS_LEVEL, BASE_STATUS_LEVEL_COMPLETED,
  BASE_STATUS_NAME, BASE_STATUS_TERMINAL, MEMORY_ORDER_AMOUNT, MEMORY_ORDER_RESOURCE,
  MEMORY_ORDER_TYPE, REACTION_STATUS_PHASE, REACTION_STATUS_RESOURCE, REACTOR_AMOUNT,
  REACTOR_INPUT_A, REACTOR_INPUT_B, REACTOR_OUTPUT, REACTOR_TASK_TYPE, TERMINAL_TASK_TYPE,
  TRANSFER_AMOUNT, TRANSFER_BASE, TRANSFER_RESOURCE
} from './constants.memory';
import {
  REACTION_PRIORITIES, TERMINAL_BUY, TERMINAL_ENERGY_BALANCE, TERMINAL_TRANSFER
} from './constants.priorities';
import {REACTION, TASK_MARKET_ORDER, TASK_TRANSFER} from './constants.tasks';
import {ACTIVE_REACTIONS, ROOM_STATUES, TASK_REACTION} from './constants.topics';
import {Kernel, KernelThreadFunc, threadKernel} from './kernel';
import {Consumer} from './lib.event_broker';
import {SigmoidPricing} from './lib.sigmoid_pricing';
import {Tracer} from './lib.tracing';
import {running} from './os.process';
import {Runnable, RunnableResult} from './os.runnable';
import {Reaction, ReactionMap} from './runnable.base_booster';
import {
  REACTION_STATUS_START, REACTION_STATUS_STOP, REACTION_STATUS_STREAM,
  REACTION_STATUS_UPDATE, TASK_PHASE_REACT
} from './runnable.base_reactor';
import {getBaseTerminalTopic, TerminalTask} from './runnable.base_terminal';

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

type CreepBoostableIntents = 'upgradeController' | 'harvest' | 'build' | 'repair' |
  'attack' | 'rangedAttack' | 'heal' | 'rangedHeal' | 'rangedMassAttack' | 'upgradeController' |
  'damage' | 'dismantle';

// Try to ensure that all colonies are ready to
// boost creeps with these effects
const MIN_CRITICAL_COMPOUND = 1000;
const MIN_CRITICAL_COMPOUND_RALLY = 5000;
const CRITICAL_EFFECTS: Partial<Record<CreepBoostableIntents, MineralBoostConstant[]>> = {
  'upgradeController': ['XGH2O', 'GH2O', 'GH'],
  // 'capacity': ['XKH2O', 'KH2O', 'KH'],
  'heal': ['XLHO2', 'LHO2', 'LO'],
  'attack': ['XUH2O', 'UH2O', 'UH'],
  'rangedAttack': ['XKHO2', 'KHO2', 'KO'],
  'damage': ['XGHO2', 'GHO2', 'GO'],
  'dismantle': ['XZH2O', 'ZH2O', 'ZH'],
};

export class ResourceManager implements Runnable {
  private kernel: Kernel;
  private pricer: SigmoidPricing;
  private resources: ResourceCounts;
  private sharedResources: ResourceCounts;

  private availableReactions = {};
  private reactorStatuses = [];
  private roomStatuses: RoomStatus[] = [];
  private reactionStats = {};
  private reactionStatuses = {};
  private reactionStatusStreamConsumer: Consumer;

  private threadUpdateResources: KernelThreadFunc;
  private threadRequestReactions: KernelThreadFunc;
  private threadRequestSellExtraResources: KernelThreadFunc;
  private threadDistributeBoosts: KernelThreadFunc;
  private threadConsumeStatuses: KernelThreadFunc;
  private threadConsumeReactionStatusStream: KernelThreadFunc;
  private threadBalanceEnergy: KernelThreadFunc;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    this.pricer = new SigmoidPricing(PRICES);
    this.resources = new Map();
    this.sharedResources = new Map();

    this.availableReactions = {};
    this.reactorStatuses = [];
    this.roomStatuses = [];
    this.reactionStats = {};
    this.reactionStatuses = {};

    this.reactionStatusStreamConsumer = kernel.getBroker().
      getStream(REACTION_STATUS_STREAM).addConsumer('resource_governor');

    this.threadUpdateResources = threadKernel('update_resources_thread', UPDATE_RESOURCES_TTL)((trace: Tracer, kernel: Kernel) => {
      this.resources = this.getBaseResources();
      this.sharedResources = this.getSharedResources();
    });

    this.threadRequestReactions = threadKernel('request_reactions_thread', REQUEST_REACTION_TTL)((trace: Tracer, kernel: Kernel) => {
      this.availableReactions = this.getReactions(kernel, trace);
      this.requestReactions(trace, kernel);
    });

    this.threadRequestSellExtraResources = threadKernel('request_sell_resources_tread', REQUEST_SELL_TTL)((trace: Tracer, kernel: Kernel) => {
      this.requestSellResource(trace, kernel);
    });

    this.threadDistributeBoosts = threadKernel('distribute_boosts_thread', REQUEST_DISTRIBUTE_BOOSTS)((trace: Tracer, kernel: Kernel) => {
      this.distributeBoosts(trace, kernel);
    });

    this.threadConsumeStatuses = threadKernel('statuses_thread', CONSUME_STATUS_TTL)(this.consumeStatuses.bind(this));
    this.threadConsumeReactionStatusStream = threadKernel('reaction_stream',
      CONSUME_STATUS_TTL)(this.consumeReactionStatusStream.bind(this));
    this.threadBalanceEnergy = threadKernel('balance_energy_thread',
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

  getBaseWithTerminalWithResource(resource: ResourceConstant, destBase: Base = null): Base {
    const basesWithTerminal = this.kernel.getPlanner().getBases().reduce((acc, base) => {
      const room = getBasePrimaryRoom(base);
      if (!room) {
        return acc;
      }

      // Don't return the room needing the resources
      if (destBase && base.id && room.name === destBase.id) {
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

        if (compounds.indexOf(resource as MineralBoostConstant) != -1) {
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

    return _.sortBy(basesWithTerminal, 'amount').reverse().shift();
  }

  getTerminals(): StructureTerminal[] {
    return this.kernel.getPlanner().getBases().reduce((acc, base) => {
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

  getSharedResources(): ResourceCounts {
    return this.kernel.getPlanner().getBases().reduce((acc, base) => {
      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        return acc;
      }

      if (!primaryRoom.terminal) {
        return acc;
      }

      const baseResources = getStoredResources(base);
      Array.from(baseResources.keys()).forEach((resource: ResourceConstant) => {
        // Find first effect for that resource
        const isCritical = Object.values(CRITICAL_EFFECTS).find((compounds) => {
          if (compounds.indexOf(resource as MineralBoostConstant) != -1) {
            return true;
          }
          return false;
        }, false);

        // If critical, subtract min compound amount
        let amount = baseResources.get(resource);
        if (isCritical) {
          amount -= MIN_CRITICAL_COMPOUND;
        }
        if (amount < 0) {
          amount = 0;
        }

        // Update the resource counts
        const current = acc.get(resource) || 0;
        acc.set(resource, amount + current);
      });

      return acc;
    }, new Map());
  }

  getBaseResources(): ResourceCounts {
    return this.kernel.getPlanner().getBases().reduce((acc, base) => {
      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        return acc;
      }

      if (!primaryRoom.terminal) {
        return acc;
      }

      const baseResources = getStoredResources(base);

      Array.from(baseResources.keys()).forEach((resource) => {
        const current = acc.get(resource) || 0;
        acc.set(resource, baseResources.get(resource) + current);
      });

      return acc;
    }, new Map());
  }

  getAmountInReserve(kernel: Kernel, resource): number {
    return kernel.getPlanner().getBases().reduce((acc, base) => {
      return acc + getStoredResourceAmount(base, resource);
    }, 0);
  }

  getReactions(kernel: Kernel, trace: Tracer): Reaction[] {
    const availableReactions: ReactionMap = new Map();
    const missingOneInput: ReactionMap = new Map();
    const overReserve: ReactionMap = new Map();

    const firstInputs = Object.keys(REACTIONS) as ResourceConstant[];
    firstInputs.forEach((inputA) => {
      // If we don't have a full batch, move onto next
      if (!this.resources.has(inputA) || this.resources.get(inputA) < REACTION_BATCH_SIZE) {
        trace.info('dont have enough of first resource', {
          inputA,
          amountA: this.resources.get(inputA) || 0,
          REACTION_BATCH_SIZE,
        });

        return;
      }

      const secondInputs = Object.keys(REACTIONS[inputA]) as ResourceConstant[];
      secondInputs.forEach((inputB) => {
        const output = REACTIONS[inputA][inputB];

        // If we don't have a full batch if input mark missing one and go to next
        if (!this.resources.has(inputB) || this.resources.get(inputB) < REACTION_BATCH_SIZE) {
          if (!missingOneInput.has(output)) {
            trace.info('dont have enough of second resource', {
              inputA,
              inputB,
              amountA: this.resources.get(inputA) || 0,
              amountB: this.resources.get(inputB) || 0,
              output,
              REACTION_BATCH_SIZE,
            });

            missingOneInput.set(output, {inputA, inputB, output});
          }

          return;
        }

        // Check if we need more of the output
        if (this.resources.get(output) > RESERVE_LIMIT && !overReserve.has(output)) {
          overReserve.set(output, {inputA, inputB, output});
          return;
        }

        // If reaction isn't already present add it
        if (!availableReactions.has(output)) {
          trace.info('adding available reaction', {
            inputA,
            inputB,
            amountA: this.resources.get(inputA) || 0,
            amountB: this.resources.get(inputB) || 0,
            output,
          });

          availableReactions.set(output as ResourceConstant, {inputA, inputB, output});
        }
      });
    });

    const sortedAvailableReactions = this.prioritizeReactions(availableReactions, 0);
    const sortedMissingOneInput = this.prioritizeReactions(missingOneInput, 5);
    // overReserve = this.prioritizeReactions(overReserve, 10);

    let nextReactions: Reaction[] = [].concat(sortedAvailableReactions);
    if (missingOneInput.size && Game.market.credits > MIN_CREDITS) {
      nextReactions = nextReactions.concat(sortedMissingOneInput);
    }
    // nextReactions = nextReactions.concat(overReserve.reverse());

    trace.info('available reactions', {nextReactions, availableReactions, missingOneInput, overReserve});

    return nextReactions;
  }

  prioritizeReactions(reactions: ReactionMap, penalty: number): Reaction[] {
    return _.sortBy(Array.from(reactions.values()), (reaction) => {
      let priority = REACTION_PRIORITIES[reaction['output']];

      // Reduce priority linearly based on amount of resource (more = lower priority)
      const amount = this.resources.get(reaction['output']) || 0;
      priority = priority * _.max([0, 1 - (amount / RESERVE_LIMIT)]);
      priority -= penalty;

      reaction['priority'] = priority;

      return priority;
    });
  }

  buyResource(base: Base, resource: any, amount: number, ttl: number, trace: Tracer) {
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
    this.kernel.getTopics().addRequest(getBaseTerminalTopic(base), TERMINAL_BUY, details, ttl);

    return true;
  }

  requestResource(base: Base, resource, amount, ttl, trace) {
    trace.log('requesting resource transfer', {baseId: base.id, resource, amount, ttl});

    const primaryRoom = getBasePrimaryRoom(base);
    if (!primaryRoom) {
      trace.error('no primary room', {baseId: base.id});
      return;
    }

    // We can't request a transfer if room lacks a terminal
    if (!primaryRoom.terminal) {
      trace.log('room does not have a terminal', {baseId: base.id});
      return false;
    }

    // Don't send transfer request if a terminal already has the task
    const inProgress = this.kernel.getPlanner().getBases().filter((base) => {
      if (!base.terminalTask) {
        return false;
      }

      return base.terminalTask[TRANSFER_RESOURCE] === resource &&
        base.terminalTask[TRANSFER_BASE] === base.id;
    }).length > 0;
    if (inProgress) {
      trace.log('task already in progress', {base: base.id, resource, amount, ttl});
      return true;
    }

    const sourceBase = this.getBaseWithTerminalWithResource(resource, base);
    if (!sourceBase) {
      trace.log('no rooms with resource', {resource});
      return false;
    }

    const sourceResources = getStoredResourceAmount(sourceBase, resource);
    amount = _.min([sourceResources, amount]);

    trace.log('requesting resource from other room', {source: sourceBase.id, resource, amount});

    const request: TerminalTask = {
      [TERMINAL_TASK_TYPE]: TASK_TRANSFER,
      [TRANSFER_RESOURCE]: resource,
      [TRANSFER_AMOUNT]: amount,
      [TRANSFER_BASE]: base.id,
    }

    this.kernel.getTopics().addRequest(getBaseTerminalTopic(sourceBase), TERMINAL_TRANSFER, request, ttl);

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

    const currentAmount = this.resources.get(resource) || 0;
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
      trace.info('no reactions to request');
      return;
    }

    trace.info('requested reactions', {
      reactions: reactions.map((r) => {
        return {
          output: r.details[REACTOR_OUTPUT],
          priority: r.priority,
        };
      }),
    });
  }

  requestSellResource(trace: Tracer, kernel: Kernel) {
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

      const sourceBase = this.getBaseWithTerminalWithResource(resource);
      if (!sourceBase) {
        return;
      }

      const sourceResources = getStoredResourceAmount(sourceBase, resource);
      const sellAmount = _.min([sourceResources, excess, MAX_SELL_AMOUNT]);

      const details = {
        [TERMINAL_TASK_TYPE]: TASK_MARKET_ORDER,
        [MEMORY_ORDER_TYPE]: ORDER_SELL,
        [MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY_ORDER_AMOUNT]: sellAmount,
      };

      kernel.getTopics().addRequest(getBaseTerminalTopic(sourceBase), TERMINAL_BUY, details, REQUEST_SELL_TTL);
    });
  }

  distributeBoosts(trace: Tracer, kernel: Kernel) {
    trace.info('balancing boosts');

    kernel.getPlanner().getBases().forEach((base) => {
      const baseTrace = trace.withFields(new Map([['base', base.id]]));
      const baseEnd = baseTrace.startTimer('colony');

      if (!base.boostPosition) {
        baseEnd();
        return;
      }

      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        baseEnd();
        return;
      }

      //const allEffects = getStoredBoosterEffects(base);
      const availableEffects = getStoredEffects(base);
      const rallyFlagRoom = Game.flags['rally']?.pos.roomName;

      Object.entries(CRITICAL_EFFECTS).forEach(([effectName, compounds]) => {
        const effectTrace = baseTrace.withFields(new Map([
          ['effect', effectName],
          ['compounds', compounds.length.toString()],
        ]));
        const effectsEnd = effectTrace.startTimer('effect');

        /*
        const effect = allEffects[effectName];
        if (!effect) {
          effectTrace.log('missing effect', {effectName});
          effectsEnd();
          return;
        }
        */

        const bestCompound = compounds[0];
        const baseResources = getStoredResources(base);
        const currentAmount = baseResources.get(bestCompound) || 0;

        const availableEffect = availableEffects.get(effectName);
        if (!availableEffect || currentAmount < MIN_CRITICAL_COMPOUND) {
          effectTrace.info('maybe request/buy best compound', {
            colonyId: base.id,
            bestCompound,
            currentAmount,
            credits: Game.market.credits,
            MIN_CRITICAL_COMPOUND,
          });

          let minimumCritical = MIN_CRITICAL_COMPOUND;
          if (primaryRoom.name === rallyFlagRoom) {
            minimumCritical = MIN_CRITICAL_COMPOUND_RALLY;
          }

          const requested = this.requestResource(base, bestCompound,
            minimumCritical - currentAmount, REQUEST_DISTRIBUTE_BOOSTS, effectTrace);

          // If we couldnt request resource, try buying
          if (!requested && Game.market.credits > MIN_BOOST_CREDITS) {
            this.buyResource(base, bestCompound, minimumCritical - currentAmount,
              REQUEST_DISTRIBUTE_BOOSTS, effectTrace);
          }
        } else {
          effectTrace.info('have booster', {colonyId: base.id, effectName, bestCompound, currentAmount});
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
    trace.info('consuming statues');

    const reactorStatuses = kernel.getTopics().getTopic(ACTIVE_REACTIONS) || [];
    this.reactorStatuses = reactorStatuses;
    trace.info('reactor statuses', {length: reactorStatuses.length});

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
    if (!roomStatuses.length) {
      trace.warn('no room statues in topic, skipping update');
      return;
    }

    this.roomStatuses = _.pluck(roomStatuses, 'details') as RoomStatus[];
    trace.info('room statuses', {length: roomStatuses.length});
  }

  balanceEnergy(trace: Tracer, kernel: Kernel) {
    if (this.roomStatuses.length < 2) {
      trace.info('not enough rooms to balance');
      return;
    }

    const hasTerminals = _.filter(this.roomStatuses, {[BASE_STATUS_TERMINAL]: true});
    if (hasTerminals.length < 2) {
      trace.info('not enough terminals to balance');
      return;
    }

    const energySorted = _.sortByAll(hasTerminals, [
      ['details', BASE_STATUS_ENERGY].join('.'),
    ]);
    const levelAndEnergySorted = _.sortByAll(hasTerminals, [
      ['details', BASE_STATUS_LEVEL].join('.'),
      ['details', BASE_STATUS_LEVEL_COMPLETED].join('.'),
      ['details', BASE_STATUS_ENERGY].join('.'),
    ]);

    trace.info('sorted', {energySorted, levelAndEnergySorted});

    const sinkRoom = levelAndEnergySorted[0];
    const baseStatus = energySorted[energySorted.length - 1];

    if (sinkRoom === baseStatus) {
      trace.info('sink and source are same');
      return;
    }

    const energyDiff = baseStatus[BASE_STATUS_ENERGY] - sinkRoom[BASE_STATUS_ENERGY];
    if (energyDiff < ENERGY_BALANCE_AMOUNT * 2) {
      trace.info('energy different too small, no need to send energy', {energyDiff});
      return;
    }

    const sourceRoomName = baseStatus[BASE_STATUS_NAME];
    const sourceBase = kernel.getPlanner().getBaseByRoom(sourceRoomName);
    if (!sourceBase) {
      trace.warn('source base not found', {sourceRoomName});
      return;
    }

    const sinkRoomName = sinkRoom[BASE_STATUS_NAME];
    const request = {
      [TERMINAL_TASK_TYPE]: TASK_TRANSFER,
      [TRANSFER_RESOURCE]: RESOURCE_ENERGY,
      [TRANSFER_AMOUNT]: ENERGY_BALANCE_AMOUNT,
      [TRANSFER_BASE]: sinkRoomName,
    };

    trace.notice('send energy request', {request});

    kernel.getTopics().addRequest(getBaseTerminalTopic(sourceBase), TERMINAL_ENERGY_BALANCE,
      request, BALANCE_ENERGY_TTL);
  }
}
