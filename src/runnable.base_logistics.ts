import {AlertLevel, Base, BaseThreadFunc, getStructureForResource, threadBase} from './base';
import {ROLE_WORKER, WORKER_HAULER} from './constants.creeps';
import {
  MEMORY_BASE, MEMORY_HAUL_AMOUNT, MEMORY_HAUL_DROPOFF, MEMORY_HAUL_PICKUP,
  MEMORY_HAUL_RESOURCE, MEMORY_TASK_TYPE, TASK_ID
} from './constants.memory';
import {roadPolicy} from './constants.pathing_policies';
import {
  DUMP_NEXT_TO_STORAGE, HAUL_BASE_ROOM, HAUL_DROPPED, LOAD_FACTOR,
  PRIORITY_HAULER
} from './constants.priorities';
import {TASK_HAUL} from './constants.tasks';
import {Kernel} from './kernel';
import {Consumer, Event} from './lib.event_broker';
import {getPath, visualizePath} from './lib.pathing';
import * as PID from './lib.pid';
import {TopicKey} from './lib.topics';
import {Tracer} from './lib.tracing';
import {PersistentMemory} from './os.memory';
import {sleeping} from './os.process';
import {RunnableResult} from './os.runnable';
import {createSpawnRequest, getBaseSpawnTopic} from './runnable.base_spawning';
import {getLinesStream, HudEventSet, HudLine} from './runnable.debug_hud';

const RUN_TTL = 5;
const CALCULATE_LEG_TTL = 20;
const BUILD_SHORTEST_LEG_TTL = 100;
const CONSUME_EVENTS_TTL = 50;
const PRODUCE_EVENTS_TTL = 100;
const REQUEST_HAULER_TTL = 50;
const UPDATE_HAULERS_TTL = 50;
const UPDATE_PID_TTL = 5;
const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 20;
const LEG_CALCULATE_INTERVAL = 1000;

// More sites means more spent per load on road construction & maintenance
const MAX_ROAD_SITES = 5;

export const getLogisticsTopic = (baseId: string): string => `${baseId}_logistics`;

export function getBaseHaulerTopic(baseId: string): TopicKey {
  return `base_${baseId}_hauler`;
}

export enum LogisticsEventType {
  RequestRoad = 'request_road',
}

export type LogisticsEventData = {
  id: string,
  position?: RoomPosition; // Required when event type is request road
};

type Leg = {
  id: string;
  destination: RoomPosition;
  path: RoomPosition[];
  remaining: RoomPosition[];
  requestedAt: number;
  updatedAt: number;
};

export default class LogisticsRunnable extends PersistentMemory {
  private baseId: string;

  private legs: Map<string, Leg>;
  private selectedLeg: Leg | null;
  private passes: number;

  private haulers: Creep[];
  private numHaulers = 0;
  private numActiveHaulers = 0;
  private numIdleHaulers = 0;
  private avgHaulerCapacity = 1000;

  private threadConsumeEvents: BaseThreadFunc;
  private threadProduceEvents: BaseThreadFunc;

  private desiredHaulers: number;
  private pidHaulersMemory: Map<string, number>;

  private threadHaulerPID: BaseThreadFunc;
  private threadRequestHaulers: BaseThreadFunc;
  private threadUpdateHaulers: BaseThreadFunc;

  private threadRequestHaulDroppedResources: BaseThreadFunc;
  private threadRequestHaulTombstones: BaseThreadFunc;

  // threadBuildRoads: ThreadFunc;
  private calculateLegIterator: Generator<any, void, {kernel: Kernel, trace: Tracer}>;
  private threadCalculateLeg: BaseThreadFunc;
  private threadBuildShortestLeg: BaseThreadFunc;
  private threadEnsureWallPassage: BaseThreadFunc;
  private logisticsStreamConsumer: Consumer;

  constructor(baseId: string) {
    super(baseId);

    this.baseId = baseId;
    this.legs = null;
    this.selectedLeg = null;
    this.passes = 0;

    this.desiredHaulers = 0;
    this.pidHaulersMemory = null;

    this.logisticsStreamConsumer = null;
    this.threadConsumeEvents = threadBase('consume_events', CONSUME_EVENTS_TTL)(this.consumeEvents.bind(this));

    // Iterate through all destinations and calculate the remaining roads to build
    this.calculateLegIterator = this.calculateLegGenerator();
    this.threadCalculateLeg = threadBase('calculate_leg', CALCULATE_LEG_TTL)((trace: Tracer, kernel: Kernel, base: Base) => {
      this.calculateLegIterator.next({trace, kernel});
    });

    this.threadUpdateHaulers = threadBase('update_haulers_thread', UPDATE_HAULERS_TTL)(this.updateHaulers.bind(this));
    this.threadHaulerPID = threadBase('hauler_pid', UPDATE_PID_TTL)(this.updatePID.bind(this));
    this.threadRequestHaulers = threadBase('request_haulers_thread', REQUEST_HAULER_TTL)(this.requestHaulers.bind(this));

    this.threadRequestHaulDroppedResources = threadBase('request_haul_dropped_thread', REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulDroppedResources.bind(this));
    this.threadRequestHaulTombstones = threadBase('request_haul_tombstone_thread', REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulTombstones.bind(this));

    // From the calculated legs, select shortest to build and build it
    this.threadBuildShortestLeg = threadBase('select_leg', BUILD_SHORTEST_LEG_TTL)(this.buildShortestLeg.bind(this));
    // Walls may be built that block access to sources, check and remove any walls along the path and replace with road
    this.threadEnsureWallPassage = threadBase('ensure_wall_passage', BUILD_SHORTEST_LEG_TTL)(this.ensureWallPassage.bind(this));

    this.threadProduceEvents = threadBase('produce_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    // Setup the stream consumer
    if (this.logisticsStreamConsumer === null) {
      const streamId = getLogisticsTopic(this.baseId);
      this.logisticsStreamConsumer = kernel.getBroker().getStream(streamId).
        addConsumer('logistics');
    }

    if (this.legs === null) {
      const memory = this.getMemory(trace) || {};
      if (memory.legs) {
        this.legs = new Map(memory.legs);
        // Hydrate the room positions
        for (const leg of this.legs.values()) {
          if (leg.path) {
            leg.path = leg.path.map((pos => new RoomPosition(pos.x, pos.y, pos.roomName)));
          }
          if (leg.remaining) {
            leg.remaining = leg.remaining.map((pos => new RoomPosition(pos.x, pos.y, pos.roomName)))
          }
        }
      } else {
        this.legs = new Map();
      }

      memory.legs = Array.from(this.legs.entries());
      this.setMemory(memory);
    }

    if (this.pidHaulersMemory === null) {
      const memory = this.getMemory(trace) || {};

      if (memory.pid) {
        this.pidHaulersMemory = new Map(memory.pid);
      } else {
        this.pidHaulersMemory = new Map();
      }

      memory.pid = Array.from(this.pidHaulersMemory.entries());
      this.setMemory(memory);

      PID.setup(this.pidHaulersMemory, 0, 0.2, 0.0005, 0);
    }

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('missing origin', {id: this.baseId});
      return sleeping(20);
    }

    trace.info('logistics', {
      id: this.baseId, legs: this.legs.size, passes: this.passes,
      selectedLeg: this.selectedLeg
    });

    this.threadConsumeEvents(trace, kernel, base);

    // If red alert, don't do anything
    if (base.alertLevel === AlertLevel.GREEN) {
      this.threadCalculateLeg(trace, kernel, base);
      this.threadBuildShortestLeg(trace, kernel, base);
      this.threadEnsureWallPassage(trace, kernel, base);
    }

    this.threadUpdateHaulers(trace, kernel, base);
    this.threadHaulerPID(trace, kernel, base);
    this.threadRequestHaulers(trace, kernel, base);

    this.threadRequestHaulDroppedResources(trace, kernel, base);
    this.threadRequestHaulTombstones(trace, kernel, base);

    this.threadProduceEvents(trace, kernel, base);

    // CLEANUP add LOG_WHEN_PID_CHECK
    if (this.selectedLeg) {
      visualizePath(this.selectedLeg.path, trace);
    }

    visualizeLegNodes(Array.from(this.legs.values()), trace);

    return sleeping(RUN_TTL);
  }

  private consumeEvents(trace: Tracer, kernel: Kernel, base: Base) {
    this.logisticsStreamConsumer.getEvents().forEach((event) => {
      switch (event.type) {
        case LogisticsEventType.RequestRoad:
          this.requestRoad(kernel, event.data.id, event.data.position, event.time, trace);
          break;
      }
    });

    // Storing legs
    trace.info('storing legs after consuming events', {legs: Array.from(this.legs.entries())});
    const memory = this.getMemory(trace) || {};
    memory.legs = Array.from(this.legs.entries());
    this.setMemory(memory);
  }

  private updateHaulers(trace: Tracer, kernel: Kernel, base: Base) {
    // Get list of haulers and workers
    const haulers = kernel.getCreepsManager().getCreepsByBaseAndRole(this.baseId, WORKER_HAULER);
    const workers = kernel.getCreepsManager().getCreepsByBaseAndRole(this.baseId, ROLE_WORKER);
    this.haulers = haulers.concat(workers);
    this.numHaulers = this.haulers.length;

    this.numActiveHaulers = this.haulers.filter((creep) => {
      const task = creep.memory[MEMORY_TASK_TYPE];
      return task === TASK_HAUL || creep.store.getUsedCapacity() > 0;
    }).length;

    this.numIdleHaulers = this.numHaulers - this.numActiveHaulers;

    // Updating the avg when there are no haulers causes some undesirable
    // situations (task explosion)
    if (this.numHaulers) {
      this.avgHaulerCapacity = this.haulers.reduce((total, hauler) => {
        return total + hauler.store.getCapacity();
      }, 0) / this.haulers.length;

      if (this.avgHaulerCapacity < 50) {
        this.avgHaulerCapacity = 50;
      }
    }
  }

  private updatePID(trace: Tracer, kernel: Kernel, base: Base) {
    let numHaulTasks = kernel.getTopics().getLength(getBaseHaulerTopic(base.id));
    numHaulTasks -= this.numIdleHaulers;

    trace.log('haul tasks', {numHaulTasks, numIdleHaulers: this.numIdleHaulers});

    this.desiredHaulers = PID.update(this.pidHaulersMemory, numHaulTasks, Game.time, trace);
    trace.info('desired haulers', {desired: this.desiredHaulers});

    // Update PID memory
    trace.info('pid memory', {pid: Array.from(this.pidHaulersMemory.entries())});
    const memory = this.getMemory(trace) || {};
    memory.pid = Array.from(this.pidHaulersMemory.entries());
    this.setMemory(memory);

    const hudLine: HudLine = {
      key: `pid_${this.baseId}`,
      room: base.primary,
      text: `Hauler PID: ${this.desiredHaulers.toFixed(2)}, ` +
        `Haul Tasks: ${numHaulTasks}, ` +
        `Num Haulers: ${this.numHaulers}, ` +
        `Idle Haulers: ${this.numIdleHaulers}`,
      time: Game.time,
      order: 10,
    };

    kernel.getBroker().getStream(getLinesStream()).publish(new Event(this.baseId, Game.time,
      HudEventSet, hudLine));
  }

  private requestHaulers(trace: Tracer, kernel: Kernel, base: Base) {
    if (Game.cpu.bucket < 2000) {
      trace.warn('bucket is low, not requesting haulers', {bucket: Game.cpu.bucket});
      return;
    }

    const room = Game.rooms[base.primary];
    if (!room) {
      trace.warn('room not found', {room: base.primary});
      return;
    }

    let role = WORKER_HAULER;
    // if the room does not have storage, then request general workers instead of haulers
    if (!room?.storage) {
      role = ROLE_WORKER;
    }

    trace.notice('request haulers', {
      numHaulers: this.numHaulers, desiredHaulers: this.desiredHaulers,
      baseId: base.id
    });

    // PID approach
    if (this.numHaulers < this.desiredHaulers) {
      let priority = PRIORITY_HAULER;

      // If we have few haulers/workers we should not be prioritizing haulers
      if (this.desiredHaulers > 3 && this.numHaulers < 2) {
        priority += 10;
      }

      priority -= this.numHaulers * 0.1;

      const ttl = REQUEST_HAULER_TTL;
      const memory = {
        [MEMORY_BASE]: base.id,
      };

      const request = createSpawnRequest(priority, ttl, role, memory, 0);
      trace.info('requesting hauler/worker', {role, priority, request});
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
    }
  }

  private produceEvents(trace: Tracer, kernel: Kernel, base: Base): void {
    const hudLine: HudLine = {
      key: `${this.baseId}`,
      room: base.primary,
      text: `Logistics - passes: ${this.passes}, legs: ${this.legs.size}, ` +
        `selected: ${this.selectedLeg?.id}, numRemaining: ${this.selectedLeg?.remaining.length}, ` +
        `end: ${this.selectedLeg?.remaining?.slice(-3, 0)}`,
      time: Game.time,
      order: 5,
    };

    kernel.getBroker().getStream(getLinesStream()).publish(new Event(this.baseId, Game.time,
      HudEventSet, hudLine));
  }

  private requestHaulDroppedResources(trace: Tracer, kernel: Kernel, base: Base) {
    if (base.alertLevel !== AlertLevel.GREEN) {
      trace.warn('do not hauler dropped resources: base alert level is not green', {alertLevel: base.alertLevel});
      return;
    }

    // iterate rooms and request haulers for any tombstones
    Object.values(base.rooms).forEach((roomName) => {
      const room = Game.rooms[roomName];
      if (!room) {
        return;
      }

      // Get resources to haul
      const droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES);

      // No resources to haul, we are done
      if (!droppedResourcesToHaul.length) {
        return;
      }

      trace.info('avg hauler capacity', {numHaulers: this.haulers.length, avgCapacity: this.avgHaulerCapacity});

      droppedResourcesToHaul.forEach((resource) => {
        const topic = getBaseHaulerTopic(base.id);
        let priority = HAUL_DROPPED;

        // Increase priority if primary room
        // TODO factor distance (or number of rooms from base)
        if (base.primary === resource.room.name) {
          priority += HAUL_BASE_ROOM;
        }

        if (room.storage?.pos.isNearTo(resource.pos)) {
          priority += DUMP_NEXT_TO_STORAGE;
        }

        const dropoff = getStructureForResource(base, resource.resourceType);
        if (!dropoff) {
          trace.warn('no dropoff for resource', {resource: resource.resourceType, baseId: base.id});
        }

        const haulersWithTask = this.haulers.filter((creep) => {
          const task = creep.memory[MEMORY_TASK_TYPE];
          const pickup = creep.memory[MEMORY_HAUL_PICKUP];
          return task === TASK_HAUL && pickup === resource.id;
        });

        const haulerCapacity = haulersWithTask.reduce((total, hauler) => {
          return total += hauler.store.getFreeCapacity();
        }, 0);

        const untaskedUsedCapacity = resource.amount - haulerCapacity;
        const loadsToHaul = Math.floor(untaskedUsedCapacity / this.avgHaulerCapacity);

        trace.info('loads', {
          avgHaulerCapacity: this.avgHaulerCapacity, haulerCapacity,
          untaskedUsedCapacity, loadsToHaul,
        });

        for (let i = 0; i < loadsToHaul; i++) {
          // Reduce priority for each load after first
          const loadPriority = priority - LOAD_FACTOR * i;

          const details = {
            [TASK_ID]: `pickup-${this.baseId}-${Game.time}`,
            [MEMORY_TASK_TYPE]: TASK_HAUL,
            [MEMORY_HAUL_PICKUP]: resource.id,
            [MEMORY_HAUL_DROPOFF]: dropoff?.id || undefined,
            [MEMORY_HAUL_RESOURCE]: resource.resourceType,
            [MEMORY_HAUL_AMOUNT]: resource.amount,
          };

          trace.log('haul dropped', {room: roomName, topic, i, loadPriority, details});

          kernel.getTopics().addRequest(topic, loadPriority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
        }
      });
    });
  }

  private requestHaulTombstones(trace: Tracer, kernel: Kernel, base: Base) {
    if (base.alertLevel !== AlertLevel.GREEN) {
      trace.warn('do not haul tombstones: base alert level is not green', {alertLevel: base.alertLevel});
      return;
    }

    Object.values(base.rooms).forEach((roomName) => {
      const room = Game.rooms[roomName];
      if (!room) {
        return;
      }

      const tombstones = room.find(FIND_TOMBSTONES, {
        filter: (tombstone) => {
          const numAssigned = this.haulers.filter((hauler: Creep) => {
            return hauler.memory[MEMORY_HAUL_PICKUP] === tombstone.id;
          }).length;

          return numAssigned === 0;
        },
      });

      tombstones.forEach((tombstone) => {
        Object.keys(tombstone.store).forEach((resourceType: ResourceConstant) => {
          trace.log('tombstone', {id: tombstone.id, resource: resourceType, amount: tombstone.store[resourceType]});
          const dropoff = getStructureForResource(base, resourceType);
          if (!dropoff) {
            trace.warn('no dropoff for resource', {resource: resourceType});
          }

          const details = {
            [TASK_ID]: `pickup-${this.baseId}-${Game.time}`,
            [MEMORY_TASK_TYPE]: TASK_HAUL,
            [MEMORY_HAUL_PICKUP]: tombstone.id,
            [MEMORY_HAUL_DROPOFF]: dropoff?.id,
            [MEMORY_HAUL_RESOURCE]: resourceType,
            [MEMORY_HAUL_AMOUNT]: tombstone.store[resourceType],
          };

          const topic = getBaseHaulerTopic(base.id);
          const priority = HAUL_DROPPED;

          trace.info('haul tombstone', {topic, priority, details});
          kernel.getTopics().addRequest(topic, priority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
        });
      });
    });
  }

  private requestRoad(kernel: Kernel, id: string, destination: RoomPosition, time: number, trace: Tracer) {
    trace.notice('request road', {id, destination, time});

    if (this.legs.has(id)) {
      const leg = this.legs.get(id);
      leg.destination = destination;
      leg.requestedAt = time;
      trace.notice('leg already exists, updating', {leg});
      this.legs.set(id, leg);
    } else {
      const leg: Leg = {
        id,
        destination,
        path: null,
        remaining: [],
        requestedAt: time,
        updatedAt: null,
      };
      trace.notice('does not exist, creating', {leg});
      this.legs.set(id, leg);
    }
  }

  private * calculateLegGenerator(): Generator<any, void, {kernel: Kernel, trace: Tracer}> {
    let legs: Leg[] = [];
    while (true) {
      const details: {kernel: Kernel, trace: Tracer} = yield;
      const kernel = details.kernel;
      const trace = details.trace;

      trace.notice('calculate legs pass', {num: legs.length, legs});

      if (!legs.length) {
        trace.notice('updating legs to calculate');
        legs = this.getLegsToCalculate(trace);
      }

      trace.notice('legs to update', {
        legs: legs.map((l) => {
          return {id: l.id, updatedAt: l.updatedAt, remaining: l.remaining.length};
        }),
      });

      const leg = legs.shift();
      if (leg) {
        const [path, remaining] = this.calculateLeg(kernel, leg, trace);
        if (path) {
          leg.path = path || [];
          leg.remaining = remaining || [];
          leg.updatedAt = Game.time;
          this.legs.set(leg.id, leg);

          // Storing legs
          trace.info('storing legs after calculating', {legs: Array.from(this.legs.entries())});
          const memory = this.getMemory(trace) || {};
          memory.legs = Array.from(this.legs.entries());
          this.setMemory(memory);
        }
      }

      if (!legs.length && this.legs.size > 0) {
        this.passes += 1;
        trace.info('pass completed', {passes: this.passes});
      }
    }
  }

  private getLegsToCalculate(trace: Tracer): Leg[] {
    // Filter out legs that need to be updated
    return Array.from(this.legs.values()).filter((leg) => {
      return leg.updatedAt < Game.time - LEG_CALCULATE_INTERVAL;
    });
  }

  private calculateLeg(kernel: Kernel, leg: Leg, trace: Tracer): [path: RoomPosition[], remaining: RoomPosition[]] {
    trace.log('updating leg', {leg});

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('missing origin', {id: this.baseId});
      return [null, null];
    }

    const [pathResult, details] = getPath(kernel, base.origin, leg.destination, roadPolicy, trace);
    trace.log('path result', {origin: base.origin, dest: leg.destination, pathResult});

    if (!pathResult) {
      trace.error('path not found', {origin: base.origin, dest: leg.destination});
      return [null, null];
    }

    const remaining = pathResult.path.filter((pos: RoomPosition) => {
      // Do not count edges as we cannot build on them
      if (pos.x === 0 || pos.y === 0 || pos.x === 49 || pos.y === 49) {
        return false;
      }

      const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });
      if (road) {
        trace.log('road found', {road});
        return false;
      }

      const site = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });
      if (site) {
        trace.log('site found', {road});
        return false;
      }

      return true;
    });

    trace.log('remaining', {remaining, leg});

    return [pathResult.path, remaining];
  }

  private ensureWallPassage(trace: Tracer, kernel: Kernel, base: Base) {
    const legs = Array.from(this.legs.values());

    const unfinishedLegs: Leg[] = legs.filter((leg: Leg) => {
      return leg.remaining.length > 0;
    });

    trace.log('unfinished legs', {unfinishedLegs});

    unfinishedLegs.forEach((leg) => {
      for (let i = 0; i < leg.path.length; i++) {
        const pos = leg.path[i];

        // Check if wall is present and remove
        const wall = pos.lookFor(LOOK_STRUCTURES).find((s) => {
          return s.structureType === STRUCTURE_WALL;
        });
        if (wall) {
          trace.warn('remove wall', {pos});
          wall.destroy();
        }

        // Check if wall site is to be built and remove
        const wallSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
          return s.structureType === STRUCTURE_WALL;
        });
        if (wallSite) {
          trace.warn('remove wall site', {pos});
          wallSite.remove();
        }

        // If there was a wall site or if we have not built too many road sites, set as a passage
        if (wall || wallSite) {
          if (!_.find(base.passages, {x: pos.x, y: pos.y})) {
            trace.warn('set as passage', {pos});
            base.passages.push({x: pos.x, y: pos.y});
          } else {
            trace.info('already a passage', {pos});
          }
        }
      }
    });
  }

  private buildShortestLeg(trace: Tracer, kernel: Kernel, base: Base) {
    if (this.passes < 1) {
      trace.log('calculate all legs at least once before building shortest leg', {passes: this.passes});
      return;
    }

    trace.log('legs', {legs: this.legs});

    // Find shortest unfinished leg
    const legs = Array.from(this.legs.values());
    const unfinishedLegs: Leg[] = legs.filter((leg: Leg) => {
      return leg.remaining.length > 0;
    });
    const sortedLegs: Leg[] = _.sortByAll(unfinishedLegs,
      (leg) => {
        // Sort sources in the primary room first
        if (leg.destination.roomName === base.primary) {
          return 0;
        }

        return 1;
      },
      (leg) => {
        return leg.remaining.length;
      },
    );

    let roadSites = 0;
    let leg: Leg = null;

    for (let s = 0; s < sortedLegs.length; s++) {
      if (roadSites >= MAX_ROAD_SITES) {
        break;
      }

      leg = sortedLegs[s];
      trace.info("building next shortest leg", {leg});

      for (let i = 0; i < leg.path.length; i++) {
        if (roadSites >= MAX_ROAD_SITES) {
          break;
        }

        const pos = leg.path[i];

        // Do not build on edges
        if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
          trace.log('skip border site', {pos});
          continue;
        }

        // Check if road is already present
        const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
          return s.structureType === STRUCTURE_ROAD;
        });
        if (road) {
          continue;
        }

        // Check if road is already planned
        const roadSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
          return s.structureType === STRUCTURE_ROAD;
        });
        if (roadSite) {
          roadSites += 1;
          continue;
        }

        // Check if wall is present and remove
        const wall = pos.lookFor(LOOK_STRUCTURES).find((s) => {
          return s.structureType === STRUCTURE_WALL;
        });
        if (wall) {
          trace.warn('remove wall', {pos});
          wall.destroy();
        }

        // Check if wall site is to be built and remove
        const wallSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
          return s.structureType === STRUCTURE_WALL;
        });
        if (wallSite) {
          trace.warn('remove wall site', {pos});
          wallSite.remove();
        }

        // If there was a wall site or if we have not built too many road sites, build a road site
        if (wall || wallSite || roadSites <= MAX_ROAD_SITES) {
          const result = pos.createConstructionSite(STRUCTURE_ROAD);
          if (result !== OK) {
            trace.error('failed to build road', {pos, result});
            continue;
          }

          trace.warn('build road site', {pos});

          roadSites += 1;
        }
      }

      this.selectedLeg = leg;
    }
  }
}

const visualizeLegNodes = (legs: Leg[], trace: Tracer) => {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg.destination) {
      trace.error('missing destination', {leg});
      continue;
    }

    new RoomVisual(leg.destination.roomName).text('X', leg.destination.x, leg.destination.y);
  }
};
