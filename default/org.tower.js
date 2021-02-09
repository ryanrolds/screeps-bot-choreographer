const OrgBase = require('./org.base');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const {doEvery} = require('./lib.scheduler');

const MIN_ROOM_ENERGY = 5000;

const REQUEST_ENERGY_TTL = 25;

class Tower extends OrgBase {
  constructor(parent, tower, trace) {
    super(parent, tower.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.tower = tower;
    this.towerUsed = 0;

    this.damagedCreep = null;
    this.damagedStructure = null;
    this.damagedSecondaryStructure = null;
    this.damagedRoad = null;

    let minEnergy = MIN_ROOM_ENERGY;
    if (this.getRoom().getRoomObject().controller.level <= 3) {
      minEnergy = 1000;
    }
    this.minEnergy = minEnergy;

    // Request energy if tower is low
    this.checkEnergy = doEvery(REQUEST_ENERGY_TTL)(() => {
      this.requestEnergy()
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('constructor');

    this.tower = Game.getObjectById(this.id);

    // was constructor
    const tower = this.tower;
    this.energy = tower.energy;

    const room = tower.room;
    const rcLevel = room.controller.level.toString();
    const rcLevelHitsMax = RAMPART_HITS_MAX[rcLevel] || 10000;
    let energyFullness = 2;
    if (room.storage) {
      energyFullness = room.storage.store.getUsedCapacity() / room.storage.store.getCapacity() * 10;
    }
    this.defenseHitsLimit = rcLevelHitsMax * Math.pow(0.45, (10 - energyFullness));

    if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
      this.defenseHitsLimit = 10000;
    }
    // was constructor end

    this.towerUsed = this.tower.store.getUsedCapacity(RESOURCE_ENERGY);

    //console.log(this);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process')

    const tower = this.tower;

    this.checkEnergy(this);

    if (this.getRoom().numHostiles) {
      let hostiles = this.getRoom().getHostiles();
      hostiles = hostiles.filter((hostile) => {
        return tower.pos.getRangeTo(hostile) <= 15;
      });

      if (hostiles.length) {
        hostiles = _.sortBy(hostiles, (hostile) => {
          return hostile.getActiveBodyparts(HEAL);
        }).reverse();

        tower.attack(hostiles[0]);
        processTrace.end();
        return;
      }
    }

    if (!this.damagedCreep && this.getRoom().damagedCreeps.length) {
      this.damagedCreep = this.getRoom().damagedCreeps.shift()
    }

    if (this.damagedCreep) {
      const creep = Game.creeps[this.damagedCreep];
      if (!creep || creep.hits >= creep.hitsMax) {
        this.damagedCreep = null;
      } else {
        tower.heal(creep);
        processTrace.end();
        return;
      }
    }

    if (this.towerUsed > 250) {
      if (!this.damagedStructure && this.getRoom().damagedStructures.length) {
        this.damagedStructure = this.getRoom().damagedStructures.shift()
      }

      if (this.damagedStructure) {
        const structure = Game.getObjectById(this.damagedStructure);
        if (!structure || structure.hits >= structure.hitsMax) {
          this.damagedStructure = null;
        } else {
          tower.repair(structure);
          processTrace.end();
          return;
        }
      }

      if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) > 4000) {
        if (!this.damagedSecondaryStructure && this.getRoom().damagedSecondaryStructures.length) {
          this.damagedSecondaryStructure = this.getRoom().damagedSecondaryStructures.shift();
        }

        if (this.damagedSecondaryStructure) {
          const secondary = Game.getObjectById(this.damagedSecondaryStructure);
          if (!secondary || secondary.hits >= secondary.hitsMax ||
            secondary.hits >= this.defenseHitsLimit) {
            this.damagedSecondaryStructure = null;
          } else {
            tower.repair(secondary);
            processTrace.end();
            return;
          }
        }

        if (!this.damagedRoad && this.getRoom().damagedRoads.length) {
          this.damagedRoad = this.getRoom().damagedRoads.shift();
        }

        if (this.damagedRoad) {
          const road = Game.getObjectById(this.damagedRoad);
          if (!road || road.hits >= road.hitsMax) {
            this.damagedRoad = null;
          } else {
            tower.repair(road);
            processTrace.end();
            return;
          }
        }
      }
    }

    processTrace.end();
  }
  toString() {
    return `---- Tower - ID: ${this.id}, Energy: ${this.energy}, ` +
      `DefenseHitsLimit: ${this.defenseHitsLimit}`;
  }
  requestEnergy() {
    const creeps = this.getRoom().getCreeps();
    const haulersWithTask = creeps.filter((creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
      return task === TASKS.TASK_HAUL && dropoff === this.id;
    }).length;
    this.roomEnergy = this.getRoom().getAmountInReserve(RESOURCE_ENERGY);

    if (this.towerUsed > 500 || haulersWithTask || this.roomEnergy <= this.minEnergy) {
      return;
    }

    const towerFree = this.tower.store.getFreeCapacity(RESOURCE_ENERGY);
    const towerTotal = this.tower.store.getCapacity(RESOURCE_ENERGY);
    const pickupId = this.getParent().getClosestStoreWithEnergy(this.tower);
    const priority = 1 - ((this.towerUsed - 250 + this.haulerUsedCapacity) / towerTotal);

    const details = {
      [MEMORY.TASK_ID]: `tel-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickupId,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: towerFree,
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.tower.id,
    };

    this.sendRequest(TOPICS.HAUL_CORE_TASK, priority, details, REQUEST_ENERGY_TTL);
  }
}

module.exports = Tower;
