const OrgBase = require('./org.base');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const MIN_ROOM_ENERGY = 5000;
const REQUEST_ENERGY_TTL = 50;

class Tower extends OrgBase {
  constructor(parent, tower, trace) {
    super(parent, tower.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.gameObject = tower; // DEPRECATED
    this.tower = tower;
    this.towerUsed = 0;

    let minEnergy = MIN_ROOM_ENERGY;
    if (this.getRoom().roomObject.controller.level <= 3) {
      minEnergy = 1000;
    }
    this.minEnergy = minEnergy;

    // Request energy if tower is low
    this.checkEnergy = doEvery(REQUEST_ENERGY_TTL)((tower) => {
      if (this.towerUsed < 500 && this.roomEnergy > this.minEnergy) {
        this.requestEnergy()
      }
    });

    setupTrace.end();
  }
  update() {
    const updateTrace = this.trace.begin('constructor');

    // was constructor
    const tower = this.gameObject
    this.energy = tower.energy;

    const haulers = this.getColony().getHaulers();
    this.haulersWithTask = _.filter(haulers, (creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
      return task === TASKS.TASK_HAUL && dropoff === this.id;
    });

    this.haulerUsedCapacity = _.reduce(this.haulersWithTask, (total, hauler) => {
      return total + hauler.store.getUsedCapacity(RESOURCE_ENERGY);
    }, 0);

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
    this.roomEnergy = this.getRoom().getAmountInReserve(RESOURCE_ENERGY);

    // console.log(this);

    updateTrace.end();
  }
  process() {
    const tower = this.tower;

    if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
      if (this.towerUsed + this.haulerUsedCapacity < 500 && this.roomEnergy > this.minEnergy) {
        this.requestEnergy()
      }
    } else {
      this.checkEnergy(this);
    }

    let hostiles = this.getRoom().getHostiles();
    if (hostiles && hostiles.length) {
      hostiles = hostiles.filter((hostile) => {
        return tower.pos.getRangeTo(hostile) <= 15;
      });

      if (hostiles.length) {
        hostiles = _.sortBy(hostiles, (hostile) => {
          return hostile.getActiveBodyparts(HEAL);
        }).reverse();

        tower.attack(hostiles[0]);
        return;
      }
    }

    const damagedCreeps = _.filter(this.getRoom().getRoomCreeps(), (creep) => {
      return creep.hits < creep.hitsMax;
    });

    const creepsByHealth = _.sortBy(damagedCreeps, (creep) => {
      return creep.hits / creep.hitsMax;
    });

    if (creepsByHealth.length) {
      tower.heal(creepsByHealth[0]);
      return;
    }

    if (this.towerUsed > 250) {
      const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) => {
          return s.hits < s.hitsMax && (
            s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART &&
            s.structureType != STRUCTURE_ROAD);
        },
      });
      if (closestDamagedStructure) {
        tower.repair(closestDamagedStructure);
        return;
      }

      if (this.getRoom().getAmountInReserve(RESOURCE_ENERGY) > 4000) {
        let damagedSecondaryStructures = tower.room.find(FIND_STRUCTURES, {
          filter: (s) => {
            return s.hits < s.hitsMax && (
              s.structureType == STRUCTURE_RAMPART ||
              s.structureType == STRUCTURE_WALL) &&
              s.hits < this.defenseHitsLimit;
          },
        });
        damagedSecondaryStructures = _.sortBy(damagedSecondaryStructures, (structure) => {
          return structure.hits;
        });
        if (damagedSecondaryStructures && damagedSecondaryStructures.length) {
          tower.repair(damagedSecondaryStructures[0]);
          return;
        }

        let damagedRoads = tower.room.find(FIND_STRUCTURES, {
          filter: (s) => {
            return s.hits < s.hitsMax && s.structureType == STRUCTURE_ROAD;
          },
        });
        damagedRoads = _.sortBy(damagedRoads, (structure) => {
          return structure.hits;
        });
        if (damagedRoads && damagedRoads.length) {
          tower.repair(damagedRoads[0]);
          return;
        }
      }
    }
  }
  toString() {
    return `---- Tower - ID: ${this.id}, Energy: ${this.energy}, DefenseHitsLimit: ${this.defenseHitsLimit}`;
  }
  requestEnergy() {
    const towerFree = this.tower.store.getFreeCapacity(RESOURCE_ENERGY);
    const towerTotal = this.tower.store.getCapacity(RESOURCE_ENERGY);

    const pickupId = this.getParent().getClosestStoreWithEnergy(this.tower);
    const amount = towerFree - this.haulerUsedCapacity;

    // The -0.01 is so that we haul full mining containers before fueling towers
    const priority = 1 - ((this.towerUsed - 250 + this.haulerUsedCapacity) / towerTotal);

    const details = {
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickupId,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.tower.id,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
    };

    this.sendRequest(TOPICS.TOPIC_HAUL_TASK, priority, details, REQUEST_ENERGY_TTL);
  }
}

module.exports = Tower;
