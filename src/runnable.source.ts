import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as CREEPS from "./constants.creeps"
import * as PRIORITIES from "./constants.priorities"
import Colony from "./org.colony";
const {creepIsFresh} = require('./behavior.commute');

const PROCESS_TTL = 250;
const REQUEST_WORKER_TTL = 50;
const REQUEST_HAULING_TTL = 20;

export default class SourceRunnable {
  orgRoom: OrgRoom;
  sourceId: Id<Source>;
  prevTime: number;

  ttl: number;
  workerTTL: number;
  haulingTTL: number;

  containerId: Id<StructureContainer>;
  linkId: Id<StructureLink>;
  dropoffId: Id<Structure>;

  desiredMiners: number;
  desiredHarvesters: number;

  constructor(room: OrgRoom, source: Source) {
    this.orgRoom = room;
    this.sourceId = source.id;
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

    this.desiredMiners = 0;
    this.desiredHarvesters = 0;
    if (this.containerId) {
      this.desiredMiners = 1;
    } else if (source instanceof Mineral) {
      this.desiredHarvesters = 1;
      if (!source.mineralAmount) {
        this.desiredHarvesters = 0;
      }
    } else {
      this.desiredHarvesters = 3;
    }
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    trace.log(this.sourceId, 'Source run', {});

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      return terminate();
    }

    this.ttl -= ticks;
    this.workerTTL -= ticks;
    this.haulingTTL -= ticks;

    if (this.workerTTL <= 0) {
      this.workerTTL = REQUEST_WORKER_TTL;

      // Check miners and harvesters
      if (this.desiredMiners) {
        this.requestMiner(room);
      } else if (this.desiredHarvesters) {
        this.requestHarvester(room);
      }
    }

    if (this.haulingTTL <= 0 && this.containerId) {
      this.haulingTTL = REQUEST_HAULING_TTL;
      this.requestHauling();
    }

    if (this.ttl < 0) {
      return terminate();
    }

    return running();
  }

  requestMiner(room: Room) {
    const roomCreeps = this.orgRoom.getCreeps();
    const numMiners = roomCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_MINER &&
        creep.memory[MEMORY.MEMORY_HARVEST] === this.sourceId &&
        creepIsFresh(creep);
    }).length;

    if (this.desiredMiners > numMiners) {
      let priority = PRIORITIES.PRIORITY_MINER;
      // Energy sources in unowned rooms require half as many parts
      if (!room.controller.my) {
        priority = PRIORITIES.PRIORITY_REMOTE_MINER;
      }

      (this.orgRoom as any).sendRequest(TOPICS.TOPIC_SPAWN, priority, {
        role: CREEPS.WORKER_MINER,
        memory: {
          [MEMORY.MEMORY_HARVEST]: this.sourceId, // Deprecated
          [MEMORY.MEMORY_HARVEST_CONTAINER]: this.containerId,
          [MEMORY.MEMORY_HARVEST_ROOM]: room.name, // Deprecated
          [MEMORY.MEMORY_SOURCE]: this.sourceId,
          [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
        },
      }, REQUEST_WORKER_TTL);
    }
  }

  requestHarvester(room: Room) {
    const roomCreeps = this.orgRoom.getCreeps();
    const numHarvesters = roomCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_HARVESTER &&
        creep.memory[MEMORY.MEMORY_HARVEST] === this.sourceId &&
        creepIsFresh(creep);
    }).length;

    if (this.desiredHarvesters > numHarvesters) {
      // As we get more harvesters, make sure other creeps get a chance to spawn
      const priority = PRIORITIES.PRIORITY_HARVESTER - (numHarvesters * 1.5);
      (this.orgRoom as any).sendRequest(TOPICS.TOPIC_SPAWN, priority, {
        role: CREEPS.WORKER_HARVESTER,
        memory: {
          [MEMORY.MEMORY_HARVEST]: this.sourceId, // Deprecated
          [MEMORY.MEMORY_HARVEST_ROOM]: room.name, // Deprecated
          [MEMORY.MEMORY_SOURCE]: this.sourceId,
          [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
        },
      }, REQUEST_WORKER_TTL);
    }
  }

  requestHauling() {
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
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: this.containerId,
        [MEMORY.MEMORY_HAUL_DROPOFF]: this.dropoffId,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      };

      (this.orgRoom as any).sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details, REQUEST_HAULING_TTL);
    }
  }
}
