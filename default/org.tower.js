const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');

class Tower extends OrgBase {
  constructor(parent, tower) {
    super(parent, tower.id);

    this.gameObject = tower;

    this.energy = tower.energy;

    const haulers = this.getColony().getHaulers()
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
      this.defenseHitsLimit = 10000
    }
  }
  update() {
    console.log(this);
  }
  process() {
    const tower = this.gameObject;
    const towerUsed = tower.store.getUsedCapacity(RESOURCE_ENERGY)
    const towerFree = tower.store.getFreeCapacity(RESOURCE_ENERGY)
    const towerTotal = tower.store.getCapacity(RESOURCE_ENERGY)
    const roomEnergy = this.getRoom().getAmountInReserve(RESOURCE_ENERGY)

    if (towerUsed + this.haulerUsedCapacity < 500 && roomEnergy > 5000) {
      const pickupId = this.parent.getClosestStoreWithEnergy(tower);
      const amount = towerFree - this.haulerUsedCapacity

      // The -0.01 is so that we haul full mining containers before fueling towers
      const priority = 1 - ((towerUsed - 250 + this.haulerUsedCapacity) / towerTotal);

      const details = {
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickupId,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: tower.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      };

      this.sendRequest(TOPICS.TOPIC_HAUL_TASK, priority, details);
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

    const damagedCreeps = _.filter(this.assignedCreeps, (creep) => {
      return creep.hits < creep.hitsMax;
    });
    const creepsByHealth = _.sortBy(damagedCreeps, (creep) => {
      return creep.hits / creep.hitsMax;
    });

    if (creepsByHealth.length) {
      tower.heal(creepsByHealth[0]);
      return;
    }

    if (tower.energy > 250) {
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
}

module.exports = Tower;
