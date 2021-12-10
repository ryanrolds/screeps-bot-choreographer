import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import {WORKER_HARVESTER, WORKER_MINER, WORKER_UPGRADER} from "./constants.creeps"
import {PRIORITY_HARVESTER, PRIORITY_MINER, PRIORITY_UPGRADER} from "./constants.priorities";
import {Colony} from './org.colony';
import {thread, ThreadFunc} from "./os.thread";
import {FindPathPolicy, getPath} from "./lib.pathing";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
const {creepIsFresh} = require('./behavior.commute');

const STRUCTURE_TTL = 50;
const DROPOFF_TTL = 200;
const REQUEST_WORKER_TTL = 50;
const REQUEST_HAULING_TTL = 20;
const ROADS_TTL = 250;
const CONTAINER_TTL = 250;

export const roadPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.SOURCE_ROAD,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 12,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
  },
};

export default class SourceRunnable {
  id: string;
  orgRoom: OrgRoom;
  sourceId: Id<Source | Mineral>;
  position: RoomPosition;
  prevTime: number;

  ttl: number;
  workerTTL: number;
  haulingTTL: number;

  containerId: Id<StructureContainer>;
  linkId: Id<StructureLink>;
  dropoffId: Id<Structure>;

  threadUpdateStructures: ThreadFunc;
  threadUpdateDropoff: ThreadFunc;
  threadRequestWorkers: ThreadFunc;
  threadRequestUpgraders: ThreadFunc;
  threadRequestHauling: ThreadFunc;
  threadBuildContainer: ThreadFunc;
  threadBuildRoads: ThreadFunc;

  constructor(room: OrgRoom, source: (Source | Mineral)) {
    this.orgRoom = room;
    this.sourceId = source.id;
    this.position = source.pos;

    this.threadUpdateStructures = thread('update_structures', STRUCTURE_TTL)(this.updateStructures.bind(this));
    this.threadUpdateDropoff = thread('update_dropoff', DROPOFF_TTL)(this.updateDropoff.bind(this));
    this.threadRequestWorkers = thread('request_workers', REQUEST_WORKER_TTL)(this.requestWorkers.bind(this));
    // this.threadRequestUpgraders = thread('request_upgraders', REQUEST_WORKER_TTL)(this.requestUpgraders.bind(this));
    this.threadRequestHauling = thread('reqeust_hauling', REQUEST_HAULING_TTL)(this.requestHauling.bind(this));
    this.threadBuildContainer = thread('build_container', CONTAINER_TTL)(this.buildContainer.bind(this));
    this.threadBuildRoads = thread('roads', ROADS_TTL)(this.buildRoads.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('source_run')
    trace.log('source run', {roomId: this.orgRoom.id, sourceId: this.sourceId});

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

    const source: Source | Mineral = Game.getObjectById(this.sourceId);
    if (!source) {
      trace.error('source not found', {id: this.sourceId});
      trace.end();
      return terminate();
    }

    this.threadUpdateStructures(trace, source);
    this.threadUpdateDropoff(trace, colony);
    this.threadRequestWorkers(trace, kingdom, colony, room, source);
    // this.threadRequestUpgraders(trace, kingdom, colony, room, source);
    this.threadRequestHauling(trace, colony);
    this.threadBuildContainer(trace, kingdom);
    this.threadBuildRoads(trace, kingdom);

    this.updateStats(kingdom, trace);

    trace.end();

    return running();
  }

  updateStructures(trace: Tracer, source: Source | Mineral) {
    // Pick container
    const containers = source.pos.findInRange<StructureContainer>(FIND_STRUCTURES, 2, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_CONTAINER;
      },
    });
    this.containerId = source.pos.findClosestByRange<StructureContainer>(containers)?.id;

    // Pick link
    const links = source.pos.findInRange<StructureLink>(FIND_STRUCTURES, 2, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_LINK;
      },
    });
    this.linkId = source.pos.findClosestByRange<StructureLink>(links)?.id;
  }

  updateDropoff(trace: Tracer, colony: Colony) {
    const primaryRoom = colony.getPrimaryRoom();
    this.dropoffId = primaryRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY)?.id;
  }

  requestUpgraders(trace: Tracer, kingdom: Kingdom, colony: Colony, room: Room, source: Source | Mineral) {
    const username = kingdom.getPlanner().getUsername();
    if (room.controller?.owner && room.controller.owner.username !== username) {
      trace.notice('room owned by someone else', {roomId: room.name, owner: room.controller?.owner?.username});
      return;
    }

    if (room.controller?.reservation && room.controller.reservation.username !== username) {
      trace.notice('room reserved by someone else', {roomId: room.name, username: room.controller.reservation.username});
      return;
    }

    if (source instanceof Mineral) {
      return;
    }

    let desiredNum = 0;

    const primaryRoom = colony.getPrimaryRoom();
    if (primaryRoom.hasStorage) {
      return;
    } else {
      // no storage, 2 upgraders
      desiredNum = 2;
      /* trying no upgrader approach
      if (this.orgRoom.getRoomLevel() >= 3) {
        desiredNum = 1;
      }
      */
    }

    const colonyCreeps = colony.getCreeps();
    const numUpgraders = colonyCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === WORKER_UPGRADER && creep.memory[MEMORY.MEMORY_SOURCE] === this.sourceId &&
        creepIsFresh(creep);
    }).length;

    trace.log('desired upgraders', {desiredNum, numUpgraders});

    for (let i = numUpgraders; i < desiredNum; i++) {
      let priority = PRIORITY_UPGRADER;

      const positionStr = [this.position.x, this.position.y, this.position.roomName].join(',');
      const details = {
        role: WORKER_UPGRADER,
        memory: {
          [MEMORY.MEMORY_SOURCE]: this.sourceId,
          [MEMORY.MEMORY_SOURCE_CONTAINER]: this.containerId,
          [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
          [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
          [MEMORY.MEMORY_COLONY]: this.orgRoom.getColony().id,
        },
      }

      trace.log('requesting upgrader', {roomId: room.name, sourceId: this.sourceId, details});

      colony.getPrimaryRoom().requestSpawn(priority, details, REQUEST_WORKER_TTL);
    }
  }

  requestWorkers(trace: Tracer, kingdom: Kingdom, colony: Colony, room: Room, source: Source | Mineral) {
    const username = kingdom.getPlanner().getUsername();

    if (room.controller?.owner && room.controller.owner.username !== username) {
      trace.notice('room owned by someone else', {roomId: room.name, owner: room.controller?.owner?.username});
      return;
    }

    if (room.controller?.reservation && room.controller.reservation.username !== username) {
      trace.notice('room reserved by someone else', {roomId: room.name, username: room.controller.reservation.username});
      return;
    }

    let desiredNumWorkers = 0;
    let desiredWorkerPriority = 0;
    let desiredWorkerType = WORKER_HARVESTER;

    const primaryRoom = colony.getPrimaryRoom();
    if (primaryRoom.hasStorage) {
      if (source instanceof Mineral) {
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
        desiredNumWorkers = 3;
        desiredWorkerType = WORKER_HARVESTER;
        desiredWorkerPriority = PRIORITY_HARVESTER;
      }
    } else {
      // no storage, 2 harvesters
      desiredNumWorkers = 2;
      if (this.orgRoom.getRoomLevel() >= 3) {
        desiredNumWorkers = 1;
      }

      desiredWorkerType = WORKER_HARVESTER;
      desiredWorkerPriority = PRIORITY_HARVESTER;
    }

    const colonyCreeps = colony.getCreeps();
    const numWorkers = colonyCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === desiredWorkerType &&
        creep.memory[MEMORY.MEMORY_SOURCE] === this.sourceId &&
        creepIsFresh(creep);
    }).length;

    trace.log('desired workers', {desiredNumWorkers, numWorkers});

    for (let i = numWorkers; i < desiredNumWorkers; i++) {
      let priority = desiredWorkerPriority;

      const positionStr = [this.position.x, this.position.y, this.position.roomName].join(',');
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

      colony.getPrimaryRoom().requestSpawn(priority, details, REQUEST_WORKER_TTL);
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
    stats.colonies[conlonyId].rooms[roomId].sources[this.sourceId] = sourceStats;
  }

  buildContainer(trace: Tracer, kingdom: Kingdom) {
    const colonyId = this.orgRoom.getColony().id;
    const colonyConfig = kingdom.getPlanner().getColonyConfigById(colonyId);
    if (!colonyConfig) {
      trace.error('no colony config', {colonyId});
      return;
    }

    if (!colonyConfig.automated) {
      trace.log('colony not automated', {colonyId});
      return;
    }

    const colonyRoom = Game.rooms[colonyConfig.primary];
    if (!colonyRoom) {
      trace.error('colony room not found', {colonyId});
      return;
    }

    if (colonyRoom.controller?.level < 3) {
      trace.log('colony room controller level too low', {colonyId, level: colonyRoom.controller.level});
      return;
    }

    const source: Source | Mineral = Game.getObjectById(this.sourceId);
    if (!source) {
      trace.error('source not found', {id: this.sourceId});
      return;
    }

    const colonyPos = new RoomPosition(colonyConfig.origin.x, colonyConfig.origin.y - 1, colonyConfig.origin.roomName);

    const path = PathFinder.search(source.pos, colonyPos);
    trace.log('path found', {colonyPos, source: source.pos, path});

    const containerPos = path.path[0];

    const container = containerPos.lookFor(LOOK_STRUCTURES).find((s) => {
      return s.structureType === STRUCTURE_CONTAINER;
    });

    if (container) {
      trace.log('container found', {container});
      return;
    }

    const sites = containerPos.lookFor(LOOK_CONSTRUCTION_SITES);
    if (sites) {
      const containerSite = sites.find((s) => {
        return s.structureType === STRUCTURE_CONTAINER;
      });

      if (containerSite) {
        trace.log('container site found', {containerSite});
        return;
      }
    }

    const result = containerPos.createConstructionSite(STRUCTURE_CONTAINER);
    trace.log('container created', {result});
  }

  buildRoads(trace: Tracer, kingdom: Kingdom) {
    const colonyId = this.orgRoom.getColony().id;
    const colonyConfig = kingdom.getPlanner().getColonyConfigById(colonyId);
    if (!colonyConfig) {
      trace.error('no colony config', {colonyId});
      return;
    }

    if (!colonyConfig.automated) {
      trace.log('colony not automated', {colonyId});
      return;
    }

    const colonyPos = new RoomPosition(colonyConfig.origin.x, colonyConfig.origin.y - 1, colonyConfig.origin.roomName);

    const source: Source | Mineral = Game.getObjectById(this.sourceId);
    if (!source) {
      trace.error('source not found', {id: this.sourceId});
      return;
    }

    trace.log('building roads', {colonyConfig, colonyPos, source: source.pos});

    const [pathResult, details] = getPath(kingdom, colonyPos, source.pos, roadPolicy, trace);

    /*
    const pathResult = PathFinder.search(colonyPos, {pos: source.pos, range: 1}, {
      plainCost: 1,
      swampCost: 1,
    });
    */

    trace.log('path found', {colonyPos, source: source.pos, pathResult});

    const path = pathResult.path;

    let roadSites = 0;
    for (let i = 0; i < path.length; i++) {
      if (roadSites >= 10) {
        trace.log('we have 10 road sites, stop adding', {i, roadSites});
        return;
      }

      const pos = path[i];
      const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });

      if (road) {
        trace.log('road found', {road});
        continue;
      }

      const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
      if (sites.length) {
        const roadSite = sites.find((s) => {
          return s.structureType === STRUCTURE_ROAD;
        });

        if (roadSite) {
          trace.log('site found', {roadSite});
          roadSites++;
          continue;
        }
      }

      const result = pos.createConstructionSite(STRUCTURE_ROAD);
      trace.log('building road', {result});
      roadSites++;
    }
  }
}
