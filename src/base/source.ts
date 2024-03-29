import {ROLE_WORKER, WORKER_HAULER, WORKER_MINER} from '../constants/creeps';
import * as MEMORY from '../constants/memory';
import {roadPolicy} from '../constants/pathing_policies';
import {
  HAUL_BASE_ROOM, HAUL_CONTAINER, LOAD_FACTOR, PRIORITY_MINER_PRIMARY,
  PRIORITY_MINER_REMOTE
} from '../constants/priorities';
import * as TASKS from '../constants/tasks';
import {getLinesStream, HudEventSet, HudLine} from '../debug/hud';
import {Event} from '../lib/event_broker';
import {getPath} from '../lib/pathing';
import {getNearbyPositions} from '../lib/position';
import {Tracer} from '../lib/tracing';
import {AlertLevel, Base, BaseThreadFunc, getStructureForResource, threadBase} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {PersistentMemory} from '../os/memory';
import {Runnable, RunnableResult, sleeping, terminate} from '../os/process';
import {getBaseHaulerTopic, getLogisticsTopic, LogisticsEventData, LogisticsEventType} from './logistics';
import {createSpawnRequest, getBaseSpawnTopic} from './spawning';

const RUN_TTL = 20;
const STRUCTURE_TTL = 200;
const DROPOFF_TTL = 200;
const BUILD_LINK_TTL = 200;
const CONTAINER_TTL = 250;

type SourceRunnableMemory = {
  creepPosition: RoomPosition;
  linkPosition: RoomPosition;
}

export default class SourceRunnable extends PersistentMemory<SourceRunnableMemory> implements Runnable {
  private id: Id<Source>;
  private creepPosition: RoomPosition | null;
  private linkPosition: RoomPosition | null;
  private openPositions: RoomPosition[];

  private containerId: Id<StructureContainer>;
  private linkId: Id<StructureLink>;
  private dropoffId: Id<Structure>;

  private threadProduceEvents: BaseThreadFunc;
  private threadUpdateStructures: BaseThreadFunc;
  private threadUpdateDropoff: BaseThreadFunc;
  private threadRequestMiners: BaseThreadFunc;
  private threadRequestHauling: BaseThreadFunc;
  private threadBuildContainer: BaseThreadFunc;
  private threadBuildLink: BaseThreadFunc;

  constructor(source: Source) {
    super(source.id);

    this.id = source.id;
    this.creepPosition = null;
    this.linkPosition = null;
    this.openPositions = null;

    this.threadProduceEvents = threadBase('consume_events', RUN_TTL)(this.produceEvents.bind(this));
    this.threadUpdateStructures = threadBase('update_structures', STRUCTURE_TTL)(this.updateStructures.bind(this));
    this.threadUpdateDropoff = threadBase('update_dropoff', DROPOFF_TTL)(this.updateDropoff.bind(this));
    this.threadBuildContainer = threadBase('build_container', CONTAINER_TTL)(this.buildContainer.bind(this));
    this.threadBuildLink = threadBase('build_link', BUILD_LINK_TTL)(this.buildLink.bind(this));

    this.threadRequestMiners = threadBase('request_miners', RUN_TTL)(this.requestMiners.bind(this));
    this.threadRequestHauling = threadBase('reqeust_hauling', RUN_TTL)(this.requestHauling.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('source_run');

    trace.info('source run', {
      sourceId: this.id,
      containerId: this.containerId,
      linkId: this.linkId,
      creepPosition: this.creepPosition,
      linkPosition: this.linkPosition,
      openPositions: this.openPositions,
    });

    const source: Source = Game.getObjectById(this.id);
    if (!source) {
      trace.error('source not found', {id: this.id});
      trace.end();
      return terminate();
    }

    if (!source.room) {
      trace.error('source room not visible', {id: this.id});
      trace.end();
      return terminate();
    }

    const base = kernel.getPlanner().getBaseByRoom(source.room.name);
    if (!base) {
      trace.error('no base config', {room: source.room.name});
      trace.end();
      return terminate();
    }

    if (!this.creepPosition || !this.linkPosition || !this.openPositions) {
      trace.info('creep or link position not set');
      this.populatePositions(trace, kernel, base, source);
    }

    this.threadProduceEvents(trace, kernel, base, source);
    this.threadUpdateStructures(trace, kernel, base, source);
    this.threadUpdateDropoff(trace, kernel, base, source);

    // If green, then build stuff
    if (base.alertLevel === AlertLevel.GREEN) {
      this.threadBuildContainer(trace, kernel, base, source);
      this.threadBuildLink(trace, kernel, base, source);
    }

    this.threadRequestMiners(trace, kernel, base, source);
    this.threadRequestHauling(trace, kernel, base, source);

    trace.getMetricsCollector().gauge('source_energy_remaining', source.energy,
      {source: this.id, base: base.id, room: source.room.name});

    trace.end();

    return sleeping(RUN_TTL);
  }

  produceEvents(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    const creepPosition = this.creepPosition;
    if (!creepPosition) {
      trace.error('no creep position', {room: source.room.name});
      return;
    }

    const data: LogisticsEventData = {
      id: source.id,
      position: creepPosition,
    };

    kernel.getBroker().getStream(getLogisticsTopic(base.id)).
      publish(new Event(this.id, Game.time, LogisticsEventType.RequestRoad, data));

    const hudLine: HudLine = {
      key: `${this.id}`,
      room: source.room.name,
      text: `source (${source.id}) - ` +
        `container: ${this.creepPosition} (${this.containerId}), ` +
        `link: ${this.linkPosition} (${this.linkId})`,
      time: Game.time,
      order: 4,
    };

    kernel.getBroker().getStream(getLinesStream()).publish(new Event(this.id, Game.time,
      HudEventSet, hudLine));
  }

  populatePositions(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    const memory = this.getMemory(trace);

    // Check memory for creep position
    const creepPosition = memory.creepPosition;
    if (creepPosition) {
      trace.info('creep position in memory', {room: source.room.name});
      this.creepPosition = new RoomPosition(creepPosition.x, creepPosition.y, creepPosition.roomName);
    }

    const linkPosition = memory.linkPosition;
    if (linkPosition) {
      trace.info('link position in memory', {room: source.room.name});
      this.linkPosition = new RoomPosition(linkPosition.x, linkPosition.y, linkPosition.roomName);
    }

    // Determine number of open spaces around the source
    let openPositions = getNearbyPositions(source.pos, 1);
    const terrain = source.room.getTerrain();
    openPositions = openPositions.filter(pos => {
      // If wall, blocked
      if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
        return false;
      }

      const blocker = source.room.lookForAt(LOOK_STRUCTURES, pos).find((s) => {
        return (OBSTACLE_OBJECT_TYPES as string[]).indexOf(s.structureType) !== -1;
      });
      if (blocker) {
        return false;
      }

      return true;
    });
    this.openPositions = openPositions;

    if (this.creepPosition && this.linkPosition && this.openPositions) {
      trace.info('creep and link positions in memory', {room: source.room.name, openPositions: this.openPositions});
      return;
    }

    const basePos = new RoomPosition(base.origin.x, base.origin.y - 1, base.origin.roomName);
    const [pathResult, details] = getPath(kernel, source.pos, basePos, roadPolicy, trace);
    if (!pathResult || !pathResult.path.length) {
      trace.error('path not found', {basePos: basePos, source: source.pos, details});
      return;
    }

    trace.info('creep position set', {creepPosition: this.creepPosition});
    this.creepPosition = pathResult.path[0];

    const availableLinkPos = getNearbyPositions(this.creepPosition, 1);
    trace.info('available link positions', {availableLinkPos});

    const filtered = availableLinkPos.filter((pos) => {
      // Remove creep position
      if (this.creepPosition.isEqualTo(pos)) {
        return false;
      }

      // Don't use the next pos in the road
      if (pathResult.path[1].isEqualTo(pos)) {
        return false;
      }

      // Dont use any positions with structures, construction sites, or walls
      const blocker = pos.look().find((result) => {
        if (result.type === 'structure' || result.type === 'constructionSite') {
          return true;
        }

        if (result.type === 'terrain' && result.terrain === 'wall') {
          return true;
        }

        return false;
      });
      if (blocker) {
        return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      trace.error('no available link position', {creepPosition: this.creepPosition, filtered, availableLinkPos});
    } else {
      this.linkPosition = filtered[0];
    }

    trace.warn('creep and link position was not set: setting', {
      sourceId: this.id,
      creepPosition: this.creepPosition,
      linkPosition: this.linkPosition,
      openPositions: this.openPositions,
    });

    // Update memory
    memory.creepPosition = this.creepPosition;
    memory.linkPosition = this.linkPosition;

    this.setMemory(memory, false);
  }

  updateStructures(trace: Tracer, _kernel: Kernel, _base: Base, _source: Source) {
    if (!this.creepPosition) {
      trace.error('creep position not set', {creepPosition: this.creepPosition});
      return;
    }

    // Pick container
    const container = this.creepPosition.lookFor(LOOK_STRUCTURES).find((s) => {
      return s.structureType === STRUCTURE_CONTAINER;
    });
    this.containerId = container?.id as Id<StructureContainer>;

    // Pick link
    const link = this.linkPosition.lookFor(LOOK_STRUCTURES).find((s) => {
      return s.structureType === STRUCTURE_LINK;
    });
    this.linkId = link?.id as Id<StructureLink>;
  }

  updateDropoff(_trace: Tracer, _kernel: Kernel, base: Base, _source: Source) {
    this.dropoffId = getStructureForResource(base, RESOURCE_ENERGY)?.id;
  }

  requestMiners(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    if (!source.room) {
      trace.error('source room not visible', {source: source});
      return;
    }

    const room = source.room;
    const username = kernel.getPlanner().getUsername();
    if (room?.controller?.owner?.username && room?.controller?.owner?.username !== username) {
      trace.info('room owned by someone else', {
        roomId: room?.name,
        owner: room?.controller?.owner?.username
      });
      return;
    }

    if (room?.controller?.reservation?.username && room?.controller?.reservation?.username !== username) {
      trace.info('room reserved by someone else', {
        roomId: room?.name,
        username: room?.controller?.reservation?.username
      });
      return;
    }

    let desiredParts = 6;
    if ((room?.controller?.owner?.username && room?.controller?.owner?.username !== username) &&
      (room?.controller?.reservation?.username && room?.controller?.reservation?.username !== username)) {
      desiredParts = 3; // Sources have half as much energy
    }

    const miners = kernel.getCreepsManager().getCreepsByBaseAndRole(base.id, WORKER_MINER).
      filter((creep) => {
        return creep.memory[MEMORY.MEMORY_SOURCE] === this.id;
      });
    const numMiners = miners.length;

    const workPartCount = miners.reduce((sum, creep) => {
      return sum + creep.getActiveBodyparts(WORK);
    }, 0);

    trace.info('num miners', {
      numMiners,
      workPartCount,
      desiredParts,
      numPositions: this.openPositions.length
    });

    if (numMiners >= this.openPositions.length) {
      trace.info('no more open positions', {numMiners, numPositions: this.openPositions.length});
      return;
    }

    if (workPartCount >= desiredParts) {
      trace.info('enough miners', {workPartCount});
      return;
    }

    // We do not have enough miners and there is room
    let positionStr = [this.creepPosition.x, this.creepPosition.y, this.creepPosition.roomName].join(',');
    if (numMiners > 0) {
      const positions = this.openPositions.filter((pos) => {
        // If miner is already assigned to this position, don't use it
        const str = [pos.x, pos.y, pos.roomName].join(',');
        if (miners.find(miner => miner.memory[MEMORY.MEMORY_SOURCE_POSITION] === str)) {
          return false;
        }

        return true;
      });

      if (!positions.length) {
        trace.error('no available positions', {numMiners, positions, openPositions: this.openPositions});
        return;
      }

      positionStr = [positions[0].x, positions[0].y, positions[0].roomName].join(',');
    }

    let priority = PRIORITY_MINER_PRIMARY;
    // if remote, use lower priority
    if (room.name !== base.primary) {
      priority = PRIORITY_MINER_REMOTE;
    }

    // Reduce priority as a source has more miners
    // Early RCL, there can be multiple miners per source we need to ensure
    // that workers/haulers are also spawned.
    priority -= numMiners * 3;

    const role = WORKER_MINER;
    const memory = {
      [MEMORY.MEMORY_SOURCE]: this.id,
      [MEMORY.MEMORY_SOURCE_CONTAINER]: this.containerId,
      [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
      [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
      [MEMORY.MEMORY_BASE]: base.id,
    };

    trace.info('requesting miner', {sourceId: this.id, priority, memory});

    const request = createSpawnRequest(priority, RUN_TTL + Game.time, role, memory, null, 0);
    kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
  }

  requestHauling(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    const container = Game.getObjectById(this.containerId);
    if (!container) {
      trace.info('no container');
      return;
    }

    const haulers = kernel.getCreepsManager().getCreepsByBaseAndRole(base.id, WORKER_HAULER);
    const workers = kernel.getCreepsManager().getCreepsByBaseAndRole(base.id, ROLE_WORKER);
    const creeps = haulers.concat(workers);

    const avgHaulerCapacity = _.sum(creeps, (creep) => {
      return creep.store.getCapacity(RESOURCE_ENERGY);
    });

    const creepsWithTask = creeps.filter((creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
      return task === TASKS.TASK_HAUL && pickup === this.containerId;
    });

    const creepWithTaskCapacity = creepsWithTask.reduce((total, hauler) => {
      return total += hauler.store.getFreeCapacity();
    }, 0);

    const averageLoad = avgHaulerCapacity / creeps.length;
    let loadSize = 300;
    if (averageLoad >= 50) {
      loadSize = averageLoad;
    }
    const storeUsedCapacity = container.store.getUsedCapacity();
    const untaskedUsedCapacity = storeUsedCapacity - creepWithTaskCapacity;
    const loadsToHaul = Math.floor(untaskedUsedCapacity / loadSize);

    let priority = HAUL_CONTAINER;

    // prioritize hauling primary room
    if (base.primary === source.room?.name) {
      priority += HAUL_BASE_ROOM;
    }

    trace.info('requesting hauling', {
      sourceId: this.id,
      priority,
      loadsToHaul,
      averageLoad,
      loadSize,
      storeUsedCapacity,
      untaskedUsedCapacity,
      creepWithTaskCapacity,
      creepsWithTask: creepsWithTask.length
    });


    for (let i = 0; i < loadsToHaul; i++) {
      // Reduce priority for each load after first
      const loadPriority = priority - LOAD_FACTOR * i;

      const details = {
        [MEMORY.TASK_ID]: `sch-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: this.containerId,
        [MEMORY.MEMORY_HAUL_DROPOFF]: this.dropoffId || undefined,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      };

      trace.info('requesting hauling', {sourceId: this.id, i, loadPriority, details});

      kernel.getTopics().addRequest(getBaseHaulerTopic(base.id), loadPriority, details, RUN_TTL + Game.time);
    }
  }

  buildContainer(trace: Tracer, _kernel: Kernel, _base: Base, source: (Source)) {
    if (source.energy) {
      trace.info('only build container if exhausting source', {id: this.id});
      return;
    }

    if (!this.creepPosition) {
      trace.error('no creep position', {id: this.id});
      return;
    }

    if (this.containerId) {
      const container = Game.getObjectById(this.containerId);
      if (container) {
        trace.info('container already built', {container});
        return;
      }
    }

    const sites = this.creepPosition.lookFor(LOOK_CONSTRUCTION_SITES).filter((site) => {
      return site.structureType === STRUCTURE_CONTAINER;
    });
    if (sites.length) {
      trace.info('container site found', {sites});
      return;
    }

    const result = this.creepPosition.createConstructionSite(STRUCTURE_CONTAINER);
    if (result !== OK) {
      trace.error('failed to build container', {result});
      return;
    }

    trace.info('container created', {id: this.id});
  }

  buildLink(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    if (!this.linkPosition) {
      trace.error('no link position', {room: source.room.name, id: this.id});
      return;
    }

    if (this.linkId) {
      const link = Game.getObjectById(this.linkId);
      if (link) {
        trace.info('link found', {link});
        return;
      }
    }

    if (!source.room?.controller) {
      trace.error('no visibility or controller', {baseId: base.id, roomName: source.room.name, id: this.id});
      return;
    }

    const roomLevel = source.room.controller?.level || 0;
    if (roomLevel < 6) {
      trace.info('room level too low', {roomLevel});
      return;
    }

    const linkSites = this.linkPosition.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
      return s.structureType === STRUCTURE_LINK;
    });
    if (linkSites) {
      trace.info('link sites found', {linkSites});
      return;
    }

    const linksInRoom = source.room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return s.structureType === STRUCTURE_LINK;
      },
    });

    const linkSitesInRoom = source.room.find(FIND_CONSTRUCTION_SITES, {
      filter: (s) => {
        return s.structureType === STRUCTURE_LINK;
      },
    });

    const maxLinks = CONTROLLER_STRUCTURES['link'][roomLevel];
    if (maxLinks <= linksInRoom.length + linkSitesInRoom.length) {
      trace.info('too many links', {maxLinks, linksInRoom});
      return;
    }

    const result = this.linkPosition.createConstructionSite(STRUCTURE_LINK);
    if (result !== OK) {
      trace.error('failed to build link', {result});
      return;
    }

    trace.notice('link created', {id: this.id});
  }
}
