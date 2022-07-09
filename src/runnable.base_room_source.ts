import {AlertLevel, Base, getStructureForResource} from './base';
import {ROLE_WORKER, WORKER_HAULER, WORKER_MINER} from "./constants.creeps";
import * as MEMORY from "./constants.memory";
import {roadPolicy} from "./constants.pathing_policies";
import {HAUL_BASE_ROOM, HAUL_CONTAINER, LOAD_FACTOR, PRIORITY_MINER} from "./constants.priorities";
import * as TASKS from "./constants.tasks";
import {Kernel} from './kernel';
import {Event} from "./lib.event_broker";
import {getPath} from "./lib.pathing";
import {getNearbyPositions} from './lib.position';
import {Tracer} from './lib.tracing';
import {PersistentMemory} from "./os.memory";
import {sleeping, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getBaseHaulerTopic, getLogisticsTopic, LogisticsEventData, LogisticsEventType} from "./runnable.base_logistics";
import {createSpawnRequest, getBaseSpawnTopic} from './runnable.base_spawning';
import {getLinesStream, HudEventSet, HudLine} from './runnable.debug_hud';

const RUN_TTL = 50;
const STRUCTURE_TTL = 200;
const DROPOFF_TTL = 200;
const BUILD_LINK_TTL = 200;
const CONTAINER_TTL = 250;
const RED_ALERT_TTL = 200;

export default class SourceRunnable extends PersistentMemory implements Runnable {
  id: Id<Source>;
  position: RoomPosition;
  creepPosition: RoomPosition | null;
  linkPosition: RoomPosition | null;

  containerId: Id<StructureContainer>;
  linkId: Id<StructureLink>;
  dropoffId: Id<Structure>;

  threadProduceEvents: ThreadFunc;
  threadUpdateStructures: ThreadFunc;
  threadUpdateDropoff: ThreadFunc;
  threadRequestMiners: ThreadFunc;
  threadRequestHauling: ThreadFunc;
  threadBuildContainer: ThreadFunc;
  threadBuildLink: ThreadFunc;

  constructor(source: Source) {
    super(source.id);

    this.id = source.id;
    this.position = source.pos;
    this.creepPosition = null;
    this.linkPosition = null;

    this.threadProduceEvents = thread('consume_events', RUN_TTL)(this.produceEvents.bind(this));
    this.threadUpdateStructures = thread('update_structures', STRUCTURE_TTL)(this.updateStructures.bind(this));
    this.threadUpdateDropoff = thread('update_dropoff', DROPOFF_TTL)(this.updateDropoff.bind(this));
    this.threadBuildContainer = thread('build_container', CONTAINER_TTL)(this.buildContainer.bind(this));
    this.threadBuildLink = thread('build_link', BUILD_LINK_TTL)(this.buildLink.bind(this));

    this.threadRequestMiners = thread('request_miners', RUN_TTL)(this.requestMiners.bind(this));
    this.threadRequestHauling = thread('reqeust_hauling', RUN_TTL)(this.requestHauling.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('source_run')

    trace.log('source run', {
      sourceId: this.id,
      containerId: this.containerId,
      linkId: this.linkId,
      creepPosition: this.creepPosition,
      linkPosition: this.linkPosition,
    });

    const source: Source = Game.getObjectById(this.id);
    if (!source) {
      trace.error('source not found', {id: this.id});
      trace.end();
      return terminate();
    }

    const base = kernel.getPlanner().getBaseByRoom(source.room.name);
    if (!base) {
      trace.error('no colony config', {room: source.room.name});
      trace.end();
      return terminate();
    }

    if (!this.creepPosition || !this.linkPosition) {
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
    const memory = this.getMemory(trace) || {};

    // Check memory for creep position
    const creepPosition = memory.creepPosition;
    if (creepPosition) {
      trace.log('creep position in memory', {room: source.room.name});
      this.creepPosition = new RoomPosition(creepPosition.x, creepPosition.y, creepPosition.roomName);
    }

    const linkPosition = memory.linkPosition;
    if (linkPosition) {
      trace.log('link position in memory', {room: source.room.name});
      this.linkPosition = new RoomPosition(linkPosition.x, linkPosition.y, linkPosition.roomName);
    }

    if (this.creepPosition && this.linkPosition) {
      trace.info('creep and link positions in memory', {room: source.room.name});
      return;
    }

    const colonyPos = new RoomPosition(base.origin.x, base.origin.y - 1,
      base.origin.roomName);

    const [pathResult, details] = getPath(kernel, source.pos, colonyPos, roadPolicy, trace);
    trace.log('path found', {origin: source.pos, dest: colonyPos, pathResult});

    if (!pathResult || !pathResult.path.length) {
      trace.error('path not found', {colonyPos, source: source.pos});
      return;
    }

    trace.log('creep position set', {creepPosition: this.creepPosition});
    this.creepPosition = pathResult.path[0];

    const availableLinkPos = getNearbyPositions(this.creepPosition, 1);
    trace.log('available link positions', {availableLinkPos});

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
      linkPosition: this.linkPosition
    });

    // Update memory
    memory.creepPosition = this.creepPosition;
    memory.linkPosition = this.linkPosition;

    this.setMemory(memory, false);
  }

  updateStructures(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
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

  updateDropoff(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    this.dropoffId = getStructureForResource(base, RESOURCE_ENERGY)?.id;
  }

  requestMiners(trace: Tracer, kernel: Kernel, base: Base, source: Source) {

    if (!this.creepPosition) {
      trace.error('creep position not set', {creepPosition: this.creepPosition});
      return;
    }

    const username = kernel.getPlanner().getUsername();

    if (!source.room) {
      trace.error('source room not set', {source: source});
      return;
    }

    const room = source.room;

    if (room.controller?.owner && room.controller.owner.username !== username) {
      trace.info('room owned by someone else', {roomId: room.name, owner: room.controller?.owner?.username});
      return;
    }

    if (room.controller?.reservation && room.controller.reservation.username !== username) {
      trace.info('room reserved by someone else', {roomId: room.name, username: room.controller.reservation.username});
      return;
    }

    const numMiners = kernel.getCreepsManager().getCreepsByBaseAndRole(base.id, WORKER_MINER).filter((creep) => {
      return creep.memory[MEMORY.MEMORY_SOURCE] === this.id
    }).length;

    trace.info('num miners', {numMiners});

    // If there are more than one miner at the source, suicide the oldest
    if (numMiners >= 2) {
      const nearbyMiners = _.sortBy(source.pos.findInRange(FIND_MY_CREEPS, 2).filter((creep) => {
        return creep.memory[MEMORY.MEMORY_ROLE] === WORKER_MINER &&
          creep.memory[MEMORY.MEMORY_SOURCE] === this.id;
      }), (creep) => {
        return creep.ticksToLive;
      });

      if (nearbyMiners.length > 1) {
        trace.info('more than one nearby miner, suiciding first', {nearbyMiners});
        nearbyMiners[0].suicide()
        return;
      }
    }

    if (numMiners < 1) {
      let positionStr = [this.creepPosition.x, this.creepPosition.y, this.creepPosition.roomName].join(',');

      const priority = PRIORITY_MINER;
      const ttl = RUN_TTL;
      const role = WORKER_MINER;
      const memory = {
        [MEMORY.MEMORY_SOURCE]: this.id,
        [MEMORY.MEMORY_SOURCE_CONTAINER]: this.containerId,
        [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
        [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
        [MEMORY.MEMORY_BASE]: base.id,
      };

      trace.info('requesting miner', {sourceId: this.id, PRIORITY_MINER, memory});

      const request = createSpawnRequest(priority, ttl, role, memory, 0);
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
      // @CONFIRM that miners are spawned
    }
  }

  requestHauling(trace: Tracer, kernel: Kernel, base: Base, source: Source) {
    const container = Game.getObjectById(this.containerId);
    if (!container) {
      trace.info('no container')
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

    const averageLoad = avgHaulerCapacity;
    const loadSize = _.min([averageLoad, 2000]);
    const storeUsedCapacity = container.store.getUsedCapacity();
    const untaskedUsedCapacity = storeUsedCapacity - creepWithTaskCapacity;
    const loadsToHaul = Math.floor(untaskedUsedCapacity / loadSize);

    let priority = HAUL_CONTAINER;

    // prioritize hauling primary room
    if (base.primary === source.room?.name) {
      priority += HAUL_BASE_ROOM;
    }

    for (let i = 0; i < loadsToHaul; i++) {
      // Reduce priority for each load after first
      const loadPriority = priority - LOAD_FACTOR * i;

      const details = {
        [MEMORY.TASK_ID]: `sch-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: this.containerId,
        [MEMORY.MEMORY_HAUL_DROPOFF]: this.dropoffId,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      };

      trace.info('requesting hauling', {sourceId: this.id, i, loadPriority, details});

      kernel.getTopics().addRequest(getBaseHaulerTopic(base.id), loadPriority, details, RUN_TTL);
    }
  }

  buildContainer(trace: Tracer, kernel: Kernel, source: (Source)) {
    if (source.energy) {
      trace.log('only build container if exhausting source', {id: this.id});
      return;
    }

    if (!this.creepPosition) {
      trace.error('no creep position', {id: this.id});
      return;
    }

    if (this.containerId) {
      const container = Game.getObjectById(this.containerId);
      if (container) {
        trace.log('container already built', {container});
        return;
      }
    }

    const sites = this.creepPosition.lookFor(LOOK_CONSTRUCTION_SITES).filter((site) => {
      return site.structureType === STRUCTURE_CONTAINER;
    });
    if (sites.length) {
      trace.log('container site found', {sites});
      return;
    }

    const result = this.creepPosition.createConstructionSite(STRUCTURE_CONTAINER);
    if (result !== OK) {
      trace.error('failed to build container', {result})
      return;
    }

    trace.log('container created', {id: this.id});
  }

  buildLink(trace: Tracer, room: Room, source: Source) {
    if (!this.linkPosition) {
      trace.error('no link position', {room: room.name, id: this.id});
      return;
    }

    if (this.linkId) {
      const link = Game.getObjectById(this.linkId);
      if (link) {
        trace.log('link found', {link});
        return;
      }
    }

    const roomLevel = room.controller?.level || 0;
    if (roomLevel < 6) {
      trace.log('room level too low', {roomLevel});
      return;
    }

    const linkSites = this.linkPosition.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
      return s.structureType === STRUCTURE_LINK;
    })
    if (linkSites) {
      trace.log('link sites found', {linkSites});
      return;
    }

    const linksInRoom = room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return s.structureType === STRUCTURE_LINK;
      }
    });

    const linkSitesInRoom = room.find(FIND_CONSTRUCTION_SITES, {
      filter: (s) => {
        return s.structureType === STRUCTURE_LINK;
      }
    });

    const maxLinks = CONTROLLER_STRUCTURES['link'][roomLevel];
    if (maxLinks <= linksInRoom.length + linkSitesInRoom.length) {
      trace.log('too many links', {maxLinks, linksInRoom});
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
