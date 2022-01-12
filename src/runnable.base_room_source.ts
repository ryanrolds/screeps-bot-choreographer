import {creepIsFresh} from './behavior.commute';
import {BaseConfig} from './config';
import {WORKER_HARVESTER, WORKER_MINER} from "./constants.creeps";
import * as MEMORY from "./constants.memory";
import {PRIORITY_HARVESTER, PRIORITY_MINER} from "./constants.priorities";
import * as TASKS from "./constants.tasks";
import * as TOPICS from "./constants.topics";
import {Event} from "./lib.event_broker";
import {getPath} from "./lib.pathing";
import {roadPolicy} from "./lib.pathing_policies";
import {Tracer} from './lib.tracing';
import {Colony} from './org.colony';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import {PersistentMemory} from "./os.memory";
import {running, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getHudStream, HudLine, HudStreamEventSet} from './runnable.debug_hud';
import {getLogisticsTopic, LogisticsEventData, LogisticsEventType} from "./runnable.base_logistics";
import {getNearbyPositions} from './lib.position';

const STRUCTURE_TTL = 50;
const DROPOFF_TTL = 200;
const REQUEST_WORKER_TTL = 50;
const REQUEST_HAULING_TTL = 20;
const PRODUCE_EVENTS_TTL = 20;
const BUILD_LINK_TTL = 200;

const CONTAINER_TTL = 250;

export default class SourceRunnable extends PersistentMemory implements Runnable {
  id: string;
  orgRoom: OrgRoom;
  sourceId: Id<Source | Mineral>;
  position: RoomPosition;
  creepPosition: RoomPosition | null;
  linkPosition: RoomPosition | null;

  ttl: number;
  workerTTL: number;
  haulingTTL: number;

  containerId: Id<StructureContainer>;
  linkId: Id<StructureLink>;
  dropoffId: Id<Structure>;

  threadProduceEvents: ThreadFunc;
  threadUpdateStructures: ThreadFunc;
  threadUpdateDropoff: ThreadFunc;
  threadRequestWorkers: ThreadFunc;
  threadRequestHauling: ThreadFunc;
  threadBuildContainer: ThreadFunc;
  threadBuildLink: ThreadFunc;
  threadBuildExtractor: ThreadFunc;

  constructor(room: OrgRoom, source: (Source | Mineral)) {
    super(source.id);

    this.id = source.id;
    this.orgRoom = room;
    this.sourceId = source.id;
    this.position = source.pos;
    this.creepPosition = null;
    this.linkPosition = null;

    this.threadProduceEvents = thread('consume_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
    this.threadUpdateStructures = thread('update_structures', STRUCTURE_TTL)(this.updateStructures.bind(this));
    this.threadUpdateDropoff = thread('update_dropoff', DROPOFF_TTL)(this.updateDropoff.bind(this));
    this.threadRequestWorkers = thread('request_workers', REQUEST_WORKER_TTL)(this.requestWorkers.bind(this));
    this.threadRequestHauling = thread('reqeust_hauling', REQUEST_HAULING_TTL)(this.requestHauling.bind(this));
    this.threadBuildContainer = thread('build_container', CONTAINER_TTL)(this.buildContainer.bind(this));
    this.threadBuildLink = thread('build_link', BUILD_LINK_TTL)(this.buildLink.bind(this));
    this.threadBuildExtractor = thread('build_extractor', CONTAINER_TTL)(this.buildExtractor.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('source_run')

    trace.log('source run', {
      roomId: this.orgRoom.id,
      sourceId: this.sourceId,
      containerId: this.containerId,
      linkId: this.linkId,
      creepPosition: this.creepPosition,
    });

    const source: Source | Mineral = Game.getObjectById(this.sourceId);
    if (!source) {
      trace.error('source not found', {id: this.sourceId});
      trace.end();
      return terminate();
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(source.room.name);
    if (!baseConfig) {
      trace.error('no colony config', {room: source.room.name});
      trace.end();
      return terminate();
    }

    if (!this.creepPosition || !this.linkPosition) {
      this.populatePositions(trace, kingdom, baseConfig, source);
    }

    // TODO try to remove the need for this
    const colony = this.orgRoom.getColony();
    if (!colony) {
      trace.error('no colony');
      trace.end();
      return terminate();
    }

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.error('terminate source: no room', {id: this.id, roomId: this.orgRoom.id});
      trace.end();
      return terminate();
    }

    this.threadProduceEvents(trace, kingdom, source);
    this.threadUpdateStructures(trace, source);
    this.threadUpdateDropoff(trace, colony);
    this.threadRequestWorkers(trace, kingdom, colony, room, source);
    this.threadRequestHauling(trace, colony);
    this.threadBuildContainer(trace, kingdom, source);
    this.threadBuildLink(trace, room, source);
    this.threadBuildExtractor(trace, room, source);
    this.updateStats(kingdom, trace);

    trace.end();

    return running();
  }

  produceEvents(trace: Tracer, kingdom: Kingdom, source: Source | Mineral) {
    const creepPosition = this.creepPosition;
    if (!creepPosition) {
      trace.error('no creep position', {room: source.room.name});
      return;
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(source.room.name);
    if (!baseConfig) {
      trace.error('no colony config', {room: source.room.name});
      return;
    }

    const data: LogisticsEventData = {
      id: source.id,
      position: creepPosition,
    };

    kingdom.getBroker().getStream(getLogisticsTopic(baseConfig.id)).
      publish(new Event(this.id, Game.time, LogisticsEventType.RequestRoad, data));

    let sourceType = 'source';
    if (source instanceof Mineral) {
      sourceType = 'mineral';
    }

    const hudLine: HudLine = {
      key: `${this.id}`,
      room: source.room.name,
      text: `${sourceType}(${source.id}) - ` +
        `container: ${this.creepPosition} (${this.containerId}), ` +
        `link: ${this.linkPosition} (${this.linkId})`,
      time: Game.time,
      order: 4,
    };

    kingdom.getBroker().getStream(getHudStream()).publish(new Event(this.id, Game.time,
      HudStreamEventSet, hudLine));
  }

  populatePositions(trace: Tracer, kingdom: Kingdom, baseConfig: BaseConfig, source: Source | Mineral) {
    trace.log('populate positions', {room: source.room.name});

    const isMineral = source instanceof Mineral;

    const memory = this.getMemory() || {};

    // Check memory for creep position
    const creepPosition = memory.creepPosition;
    if (creepPosition) {
      trace.log('creep position in memory', {room: source.room.name});
      this.creepPosition = new RoomPosition(creepPosition.x, creepPosition.y, creepPosition.roomName);
    }

    const linkPosition = memory.linkPosition;
    if (linkPosition && !isMineral) {
      trace.log('link position in memory', {room: source.room.name});
      this.linkPosition = new RoomPosition(linkPosition.x, linkPosition.y, linkPosition.roomName);
    }

    if ((this.linkPosition || isMineral) && this.creepPosition) {
      trace.log('both positions in memory', {room: source.room.name});
      return;
    }

    const colonyPos = new RoomPosition(baseConfig.origin.x, baseConfig.origin.y - 1,
      baseConfig.origin.roomName);

    const [pathResult, details] = getPath(kingdom, source.pos, colonyPos, roadPolicy, trace);
    trace.log('path found', {origin: source.pos, dest: colonyPos, pathResult});

    if (!pathResult || !pathResult.path.length) {
      trace.error('path not found', {colonyPos, source: source.pos});
      return;
    }

    trace.log('creep position set', {creepPosition: this.creepPosition});
    this.creepPosition = pathResult.path[0];

    if (!isMineral) {
      const availableLinkPos = getNearbyPositions(this.creepPosition, 1);
      trace.notice('available link positions', {availableLinkPos});

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
        trace.notice('link position set', {linkPosition: this.linkPosition, filtered});
        this.linkPosition = filtered[0];
      }
    }

    // Update memory
    memory.creepPosition = this.creepPosition;
    memory.linkPosition = this.linkPosition;

    this.setMemory(memory);
  }

  updateStructures(trace: Tracer) {
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
    const link = this.creepPosition.findInRange(FIND_STRUCTURES, 1).find((s) => {
      return s.structureType === STRUCTURE_LINK;
    });
    this.linkId = link?.id as Id<StructureLink>;
  }

  updateDropoff(trace: Tracer, colony: Colony) {
    const primaryRoom = colony.getPrimaryRoom();
    this.dropoffId = primaryRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY)?.id;
  }

  requestWorkers(trace: Tracer, kingdom: Kingdom, colony: Colony, room: Room, source: Source | Mineral) {
    if (!this.creepPosition) {
      trace.error('creep position not set', {creepPosition: this.creepPosition});
      return;
    }

    const username = kingdom.getPlanner().getUsername();

    if (room.controller?.owner && room.controller.owner.username !== username) {
      trace.log('room owned by someone else', {roomId: room.name, owner: room.controller?.owner?.username});
      return;
    }

    if (room.controller?.reservation && room.controller.reservation.username !== username) {
      trace.log('room reserved by someone else', {roomId: room.name, username: room.controller.reservation.username});
      return;
    }

    let desiredNumWorkers = 0;
    let desiredWorkerPriority = 0;
    let desiredWorkerType = WORKER_HARVESTER;

    const primaryRoom = colony.getPrimaryRoom();
    if (primaryRoom.hasStorage) {
      if (source instanceof Mineral) {
        const extractor = source.pos.lookFor(LOOK_STRUCTURES).
          find((s) => s.structureType === STRUCTURE_EXTRACTOR)
        if (!extractor) {
          trace.error('no extractor found', {sourceId: source.id});
          return;
        }

        // if mineral && storage, 1 harvester
        desiredNumWorkers = 1;
        desiredWorkerType = WORKER_HARVESTER;
        desiredWorkerPriority = PRIORITY_HARVESTER;

        if (!source.mineralAmount) {
          desiredNumWorkers = 0;
        }
      } else if (this.containerId) {
        // if container && storage, 1 miner
        desiredNumWorkers = 1;
        desiredWorkerType = WORKER_MINER;
        desiredWorkerPriority = PRIORITY_MINER;
      } else {
        // 3 harvesters
        //desiredNumWorkers = 3;
        //desiredWorkerType = WORKER_HARVESTER;
        //desiredWorkerPriority = PRIORITY_HARVESTER;

        // trying only miners approach
        desiredNumWorkers = 1;
        desiredWorkerType = WORKER_MINER;
        desiredWorkerPriority = PRIORITY_MINER;
      }
    } else {
      // no storage, 3 harvesters
      desiredNumWorkers = 3;
      //if (this.orgRoom.getRoomLevel() >= 3) {
      //  desiredNumWorkers = 1;
      //}

      desiredWorkerType = WORKER_HARVESTER;
      desiredWorkerPriority = PRIORITY_HARVESTER;

      // trying only miners approach
      //desiredNumWorkers = 1;
      //desiredWorkerType = WORKER_MINER;
      //desiredWorkerPriority = PRIORITY_MINER;
    }

    const colonyCreeps = colony.getCreeps();
    const numWorkers = colonyCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === desiredWorkerType &&
        creep.memory[MEMORY.MEMORY_SOURCE] === this.sourceId &&
        creepIsFresh(creep);
    }).length;

    trace.log('desired workers', {desiredWorkerType, desiredNumWorkers, numWorkers});

    for (let i = numWorkers; i < desiredNumWorkers; i++) {
      let priority = desiredWorkerPriority;

      let positionStr = [this.creepPosition.x, this.creepPosition.y, this.creepPosition.roomName].join(',');
      if (desiredWorkerType === WORKER_HARVESTER) {
        positionStr = [source.pos.x, source.pos.y, source.pos.roomName].join(',');
      }


      const details = {
        role: desiredWorkerType,
        memory: {
          [MEMORY.MEMORY_SOURCE]: this.sourceId,
          [MEMORY.MEMORY_SOURCE_CONTAINER]: this.containerId,
          [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
          [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
          [MEMORY.MEMORY_COLONY]: this.orgRoom.getColony().id,
        },
      }

      trace.log('requesting worker', {roomId: room.name, sourceId: this.sourceId, details});

      colony.getPrimaryRoom().requestSpawn(priority, details, REQUEST_WORKER_TTL, trace);
    }
  }

  requestHauling(trace: Tracer, colony: Colony) {
    const haulers = colony.getHaulers();
    const haulersWithTask = haulers.filter((creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
      return task === TASKS.TASK_HAUL && pickup === this.containerId;
    });

    const avgHaulerCapacity = colony.getAvgHaulerCapacity();

    const haulerCapacity = haulersWithTask.reduce((total, hauler) => {
      return total += hauler.store.getFreeCapacity();
    }, 0);

    const container = Game.getObjectById(this.containerId);
    if (!container) {
      return;
    }

    const averageLoad = avgHaulerCapacity;
    const loadSize = _.min([averageLoad, 1000]);
    const storeCapacity = container.store.getCapacity();
    const storeUsedCapacity = container.store.getUsedCapacity();
    const untaskedUsedCapacity = storeUsedCapacity - haulerCapacity;
    const loadsToHaul = Math.floor(untaskedUsedCapacity / loadSize);

    for (let i = 0; i < loadsToHaul; i++) {
      const loadPriority = (storeUsedCapacity - (i * loadSize)) / storeCapacity;

      const details = {
        [MEMORY.TASK_ID]: `sch-${this.sourceId}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: this.containerId,
        [MEMORY.MEMORY_HAUL_DROPOFF]: this.dropoffId,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      };

      trace.log('requesting hauling', {sourceId: this.sourceId});

      colony.sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details, REQUEST_HAULING_TTL);
    }
  }

  updateStats(kingdom: Kingdom, trace: Tracer) {
    const source = Game.getObjectById(this.sourceId);
    if (!source || !(source instanceof Source)) {
      return;
    }

    const container = Game.getObjectById(this.containerId);

    const stats = kingdom.getStats();
    const sourceStats = {
      energy: source.energy,
      capacity: source.energyCapacity,
      regen: source.ticksToRegeneration,
      containerFree: (container != null) ? container.store.getFreeCapacity() : null,
    };

    const conlonyId = this.orgRoom.getColony().id;
    const roomId = this.orgRoom.id;

    if (stats.colonies[conlonyId]?.rooms[roomId]?.sources) {
      stats.colonies[conlonyId].rooms[roomId].sources[this.sourceId] = sourceStats;
    }
  }

  buildContainer(trace: Tracer, kingdom: Kingdom, source: (Source | Mineral)) {
    if (!this.creepPosition) {
      trace.log('no creep position', {id: this.sourceId});
      return;
    }

    if (source instanceof Mineral) {
      trace.log('do not build container for minerals', {id: this.sourceId});
      return;
    }

    const orgRoom = kingdom.getRoomByName(source.room.name);
    if (!orgRoom) {
      trace.log('no org room', {id: this.sourceId});
      return;
    }

    if (!orgRoom.hasStorage) {
      trace.log('no storage in room', {id: this.sourceId});
      return;
    }

    const container = this.creepPosition.lookFor(LOOK_STRUCTURES).find((s) => {
      return s.structureType === STRUCTURE_CONTAINER;
    });

    if (container) {
      trace.log('container found', {container});
      return;
    }

    const sites = this.creepPosition.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites) {
      const containerSite = sites.find((s) => {
        return s.structureType === STRUCTURE_CONTAINER;
      });

      if (containerSite) {
        trace.log('container site found', {containerSite});
        return;
      }
    }

    const result = this.creepPosition.createConstructionSite(STRUCTURE_CONTAINER);
    trace.log('container created', {result});
  }

  buildLink(trace: Tracer, room: Room, source: Source | Mineral) {
    if (source instanceof Mineral) {
      trace.log('minerals do not get links', {id: this.sourceId});
      return;
    }

    if (!this.linkPosition) {
      trace.error('no link position', {room: room.name, id: this.sourceId});
      return;
    }

    const link = this.linkPosition.look().find((s) => {
      if (s.type === LOOK_STRUCTURES) {
        return s.structure.structureType === STRUCTURE_LINK;
      }

      if (s.type === LOOK_CONSTRUCTION_SITES) {
        return s.constructionSite.structureType === STRUCTURE_LINK;
      }

      return false;
    });
    if (link) {
      trace.log('link found', {link});
      return;
    }

    const roomLevel = room.controller?.level || 0;
    if (roomLevel < 6) {
      trace.log('room level too low', {roomLevel});
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
    trace.notice('link created', {result});
  }

  buildExtractor(trace: Tracer, room: Room, source: Source | Mineral) {
    if (source instanceof Source) {
      trace.log('sources do not get extractors', {id: this.sourceId});
      return;
    }

    if (room.controller?.level < 6) {
      trace.log('room too low for extractor', {id: this.sourceId});
      return;
    }

    const extractor = source.pos.lookFor(LOOK_STRUCTURES).find((structure) => {
      return structure.structureType === STRUCTURE_EXTRACTOR;
    });

    if (!extractor) {
      const site = source.pos.lookFor(LOOK_CONSTRUCTION_SITES).find((site) => {
        return site.structureType === STRUCTURE_EXTRACTOR;
      });

      if (!site) {
        trace.log('building extractor', {id: this.sourceId});
        room.createConstructionSite(source.pos, STRUCTURE_EXTRACTOR);
      }
    }
  }
}
