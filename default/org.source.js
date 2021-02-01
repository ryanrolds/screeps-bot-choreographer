const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const CREEPS = require('./constants.creeps');
const PRIORITIES = require('./constants.priorities');
const {creepIsFresh} = require('./behavior.commute');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const REQUEST_WORKER_TTL = 100;

class Source extends OrgBase {
  constructor(parent, source, sourceType, trace) {
    super(parent, source.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.sourceType = sourceType;
    this.gameObject = source; // DEPRECATED
    this.source = source;
    this.roomID = source.room.name;

    this.container = null;
    this.containerID = null;
    this.containerUser = null;

    setupTrace.end();
  }
  update() {
    // was constructor
    const source = this.source;
    const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_CONTAINER;
      },
    });

    const container = source.pos.findClosestByRange(containers);

    if (container) {
      this.container = container;
      this.containerID = container.id;
      this.containerUsed = this.container.store.getUsedCapacity();
    }

    const roomCreeps = this.getRoom().getCreeps();
    this.numHarvesters = _.filter(roomCreeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_HARVESTER &&
        creep.memory[MEMORY.MEMORY_HARVEST] === this.id &&
        creepIsFresh(creep);
    }).length;

    this.numMiners = _.filter(roomCreeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_MINER &&
        creep.memory[MEMORY.MEMORY_HARVEST] === this.id &&
        creepIsFresh(creep);
    }).length;

    const haulers = this.getColony().getHaulers();
    this.haulersWithTask = _.filter(haulers, (creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
      return task === TASKS.TASK_HAUL && pickup === this.containerID;
    });

    this.avgHaulerCapacity = this.getColony().getAvgHaulerCapacity();

    this.haulerCapacity = _.reduce(this.haulersWithTask, (total, hauler) => {
      return total += hauler.store.getFreeCapacity();
    }, 0);
    // was constructor end

    // console.log(this);

    const room = this.getColony().getRoomByID(this.roomID);
    if ((room.numHostiles > 0) && !room.isPrimary) {
      // Do not request hauling or more workers if room has hostiles and is not the main room
      return;
    }

    this.sendHaulTasks();

    // Don't send miners or harvesters if room isn't claimed/reserved by me
    if (!room.claimedByMe && !room.reservedByMe) {
      return;
    }

    let desiredHarvesters = 3;
    let desiredMiners = 0;

    // If there is a container, we want a miner and a hauler
    if (this.container) {
      desiredHarvesters = 0;
      desiredMiners = 1;
    }

    if (this.sourceType !== 'energy') {
      desiredHarvesters = 1;
    }

    if (this.numHarvesters < desiredHarvesters) {
      if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
        this.requestHarvester()
      } else {
        this.doRequestHarvester()
      }
    }

    if (this.numMiners < desiredMiners) {
      if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
        this.requestMiner()
      } else {
        this.doRequestMiner()
      }
    }
  }
  process() {
    this.updateStats();
  }
  toString() {
    return `---- Source - ${this.id}, ` +
      `#Harvesters: ${this.numHarvesters}, ` +
      `#Miners: ${this.numMiners}, ` +
      `Container: ${this.containerID}, ` +
      `#HaulerWithTask: ${this.haulersWithTask.length}, ` +
      `SumHaulerTaskCapacity: ${this.haulerCapacity}, ` +
      `UsedCapacity: ${this.containerUsed}`;
  }
  updateStats() {
    const source = this.gameObject;

    const stats = this.getStats();
    const sourceStats = {
      energy: source.energy,
      capacity: source.energyCapacity,
      regen: source.ticksToRegeneration,
      containerFree: (this.container != null) ? this.container.store.getFreeCapacity() : null,
    };

    stats.colonies[this.getColony().id].rooms[this.roomID].sources[this.id] = sourceStats;
  }
  sendHaulTasks() {
    if (!this.container) {
      return;
    }

    const averageLoad = this.avgHaulerCapacity || 300;
    const loadSize = _.min([averageLoad, 1000]);
    const storeCapacity = this.container.store.getCapacity();
    const storeUsedCapacity = this.container.store.getUsedCapacity();
    const untaskedUsedCapacity = storeUsedCapacity - this.haulerCapacity;
    const loadsToHaul = Math.floor(untaskedUsedCapacity / loadSize);

    for (let i = 0; i < loadsToHaul; i++) {
      const loadPriority = (storeUsedCapacity - (i * loadSize)) / storeCapacity;

      const details = {
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: this.container.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      };

      console.log("source load", loadPriority, JSON.stringify(details))

      this.sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details);
    }
  }
  requestHarvester() {
    // As we get more harvesters, make sure other creeps get a chance to spawn
    const priority = PRIORITIES.PRIORITY_HARVESTER - (this.numHarvesters * 1.5);
    this.sendRequest(TOPICS.TOPIC_SPAWN, priority, {
      role: CREEPS.WORKER_HARVESTER,
      memory: {
        [MEMORY.MEMORY_HARVEST]: this.id, // Deprecated
        [MEMORY.MEMORY_HARVEST_ROOM]: this.roomID, // Deprecated
        [MEMORY.MEMORY_SOURCE]: this.id,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.roomID,
      },
    }, REQUEST_WORKER_TTL);
  }
  requestMiner() {
    const role = CREEPS.WORKER_MINER;
    let priority = PRIORITIES.PRIORITY_MINER;

    // Energy sources in unowned rooms require half as many parts
    if (!this.gameObject.room.controller.my) {
      priority = PRIORITIES.PRIORITY_REMOTE_MINER;
    }

    this.sendRequest(TOPICS.TOPIC_SPAWN, priority, {
      role: role,
      memory: {
        [MEMORY.MEMORY_HARVEST]: this.id, // Deprecated
        [MEMORY.MEMORY_HARVEST_CONTAINER]: this.containerID,
        [MEMORY.MEMORY_HARVEST_ROOM]: this.roomID, // Deprecated
        [MEMORY.MEMORY_SOURCE]: this.id,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.roomID,
      },
    }, REQUEST_WORKER_TTL);
  }
}

module.exports = Source;
