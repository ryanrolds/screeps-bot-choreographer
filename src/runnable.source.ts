import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import {WORKER_HARVESTER, WORKER_MINER, WORKER_UPGRADER} from "./constants.creeps"
import {PRIORITY_HARVESTER, PRIORITY_MINER, PRIORITY_UPGRADER} from "./constants.priorities";
import * as PRIORITIES from "./constants.priorities"
import {Colony} from './org.colony';
const {creepIsFresh} = require('./behavior.commute');

const PROCESS_TTL = 250;
const REQUEST_WORKER_TTL = 50;
const REQUEST_HAULING_TTL = 20;

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

  desiredNumWorkers: number;
  desiredWorkerType: string;
  desiredWorkerPriority: number;

  constructor(room: OrgRoom, source: (Source | Mineral)) {
    this.orgRoom = room;
    this.sourceId = source.id;
    this.position = source.pos;
    this.prevTime = Game.time;
    this.ttl = PROCESS_TTL;
    this.workerTTL = 0;
    this.haulingTTL = 0;

    // Pick container
    const containers = source.pos.findInRange<StructureContainer>(FIND_STRUCTURES, 2, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_CONTAINER;
      },
    });
    this.containerId = source.pos.findClosestByRange<StructureContainer>(containers)?.id;

    // Pink link
    const links = source.pos.findInRange<StructureLink>(FIND_STRUCTURES, 2, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_LINK;
      },
    });
    this.linkId = source.pos.findClosestByRange<StructureLink>(links)?.id;

    const colony: Colony = (this.orgRoom as any).getColony();
    const primaryRoom: OrgRoom = colony.getPrimaryRoom();
    this.dropoffId = primaryRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY)?.id;

    this.desiredNumWorkers = 0;
    this.desiredWorkerPriority = 0;
    this.desiredWorkerType = WORKER_HARVESTER;

    if (primaryRoom.hasStorage) {
      if (source instanceof Mineral) {
        // if mineral && storage, 1 harvester
        this.desiredNumWorkers = 1;
        this.desiredWorkerType = WORKER_HARVESTER;
        this.desiredWorkerPriority = PRIORITY_HARVESTER;

        if (!source.mineralAmount) {
          this.desiredNumWorkers = 0;
        }
      } else if (this.containerId) {
        // if container && storage, 1 miner
        this.desiredNumWorkers = 1;
        this.desiredWorkerType = WORKER_MINER;
        this.desiredWorkerPriority = PRIORITY_MINER;
      } else {
        // 3 harvesters
        this.desiredNumWorkers = 3;
        this.desiredWorkerType = WORKER_HARVESTER;
        this.desiredWorkerPriority = PRIORITY_HARVESTER;
      }
    } else {
      // no storage, 3 upgraders
      this.desiredNumWorkers = 3;
      this.desiredWorkerType = WORKER_UPGRADER;
      this.desiredWorkerPriority = PRIORITY_UPGRADER;
    }
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.sourceId);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    trace.log('source run', {
      workerTTL: this.workerTTL,
      haulingTTL: this.haulingTTL,
    });

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.error('terminate source: no room', {id: this.id, roomId: this.orgRoom.id});
      return terminate();
    }

    this.updateStats(kingdom);

    this.ttl -= ticks;
    this.workerTTL -= ticks;
    this.haulingTTL -= ticks;

    if (this.workerTTL < 0) {
      this.workerTTL = REQUEST_WORKER_TTL;

      if (this.desiredNumWorkers) {
        this.requestWorkers(room, trace)
      }
    }

    if (this.haulingTTL <= 0 && this.containerId) {
      this.haulingTTL = REQUEST_HAULING_TTL;
      this.requestHauling(trace);
    }

    if (this.ttl < 0) {
      trace.log('source ttl expired', {id: this.id, roomId: this.orgRoom.id});
      return terminate();
    }

    return running();
  }

  updateStats(kingdom: Kingdom) {
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

    const conlonyId = (this.orgRoom as any).getColony().id;
    const roomId = (this.orgRoom as any).id;
    stats.colonies[conlonyId].rooms[roomId].sources[this.sourceId] = sourceStats;
  }

  requestWorkers(room: Room, trace: Tracer) {
    const colonyCreeps = this.orgRoom.getColony().getCreeps();
    const numWorkers = colonyCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === this.desiredWorkerType &&
        creep.memory[MEMORY.MEMORY_SOURCE] === this.sourceId &&
        creepIsFresh(creep);
    }).length;

    for (let i = numWorkers; i < this.desiredNumWorkers; i++) {
      let priority = this.desiredWorkerPriority;

      const positionStr = [this.position.x, this.position.y, this.position.roomName].join(',');
      const details = {
        role: this.desiredWorkerType,
        memory: {
          [MEMORY.MEMORY_SOURCE]: this.sourceId,
          [MEMORY.MEMORY_SOURCE_CONTAINER]: this.containerId,
          [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
          [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
          [MEMORY.MEMORY_COLONY]: (this.orgRoom as any).getColony().id,
        },
      }

      trace.notice('requesting worker', {details});

      this.orgRoom.requestSpawn(priority, details, REQUEST_WORKER_TTL);
    }
  }

  requestHauling(trace: Tracer) {
    const haulers = (this.orgRoom as any).getColony().getHaulers();
    const haulersWithTask = haulers.filter((creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
      return task === TASKS.TASK_HAUL && pickup === this.containerId;
    });

    const avgHaulerCapacity = (this.orgRoom as any).getColony().getAvgHaulerCapacity();

    const haulerCapacity = haulersWithTask.reduce((total, hauler) => {
      return total += hauler.store.getFreeCapacity();
    }, 0);

    const container = Game.getObjectById(this.containerId);
    if (!container) {
      this.ttl = -1;
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

      (this.orgRoom as any).sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details, REQUEST_HAULING_TTL);
    }
  }
}
