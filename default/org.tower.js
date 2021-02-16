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
      this.requestEnergy();
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('constructor');

    this.tower = Game.getObjectById(this.id);
    if (!this.tower) {
      console.log(`game object for tower ${this.id} not found`);
      updateTrace.end();
      return;
    }

    // was constructor
    const tower = this.tower;
    this.energy = tower.energy;

    const room = tower.room;
    let energyFullness = 1;
    if (room.storage) {
      energyFullness = room.storage.store.getUsedCapacity() / room.storage.store.getCapacity() * 10;
    }
    // was constructor end

    this.towerUsed = this.tower.store.getUsedCapacity(RESOURCE_ENERGY);

    // console.log(this);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    if (!this.tower) {
      console.log(`game object for tower ${this.id} not found`);
      processTrace.end();
      return;
    }

    const tower = this.tower;
    const room = this.getRoom();

    this.checkEnergy(this);

    // Attack hostiles
    if (room.numHostiles) {
      let hostiles = room.getHostiles();
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

    // Heal damaged creeps
    if (!this.damagedCreep && room.damagedCreeps.length) {
      this.damagedCreep = room.damagedCreeps.shift();
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

    // If tower energy
    if (this.towerUsed > 250) {
      if (!this.damagedStructure && room.damagedStructures.length) {
        this.damagedStructure = room.damagedStructures.shift();
        this.ttl = 10;
      }

      if (this.damagedStructure) {
        const structure = Game.getObjectById(this.damagedStructure);
        if (!structure || structure.hits >= structure.hitsMax || this.ttl === 0) {
          this.damagedStructure = null;
        } else {
          tower.repair(structure);
          processTrace.end();
          return;
        }
      }

      if (room.resources[RESOURCE_ENERGY] > 10000) {
        if (!this.damagedSecondaryStructure && room.damagedSecondaryStructures.length) {
          this.damagedSecondaryStructure = room.damagedSecondaryStructures.shift();
          this.ttl = 60;
        }

        if (this.damagedSecondaryStructure) {
          const secondary = Game.getObjectById(this.damagedSecondaryStructure);
          if (!secondary || secondary.hits >= secondary.hitsMax ||
            secondary.hits >= room.defenseHitsLimit || this.ttl === 0) {
            this.damagedSecondaryStructure = null;
          } else {
            this.ttl -= 1;
            tower.repair(secondary);
            processTrace.end();
            return;
          }
        }

        if (!this.damagedRoad && room.damagedRoads.length) {
          this.damagedRoad = room.damagedRoads.shift();
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
    return `---- Tower - ID: ${this.id}, Energy: ${this.energy}`;
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
