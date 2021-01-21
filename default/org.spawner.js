const OrgBase = require('./org.base');
const {TOPIC_SPAWN} = require('./constants.topics');
const creepHelpers = require('./helpers.creeps');
const {definitions} = require('./constants.creeps');

class Spawner extends OrgBase {
  constructor(parent, spawner) {
    super(parent, spawner.id);

    this.roomId = spawner.room.name;
    this.gameObject = spawner;
    spawner.memory['ticksIdle'] = 0;

    this.isIdle = !spawner.spawning;
    this.energy = spawner.room.energyAvailable;
    this.energyCapacity = spawner.room.energyCapacityAvailable;
    this.energyPercentage = this.energy / this.energyCapacity;
  }
  update() {
    console.log(this);
  }
  process() {
    const spawnTopicSize = this.getTopicLength(TOPIC_SPAWN);
    const spawnTopicBackPressure = Math.floor(this.energyCapacity * (1 - (0.09 * spawnTopicSize)));
    let energyLimit = _.max([300, spawnTopicBackPressure]);

    let minEnergy = 300;
    const numCreeps = this.getColony().numCreeps;
    if (this.energyCapacity > 800) {
      if (numCreeps > 50) {
        minEnergy = this.energyCapacity * 0.90;
      } else if (numCreeps > 30) {
        minEnergy = this.energyCapacity * 0.80;
      } else if (numCreeps > 20) {
        minEnergy = this.energyCapacity * 0.60;
      } else if (numCreeps > 10) {
        minEnergy = 500;
      }
    }
    minEnergy = _.min([minEnergy, spawnTopicBackPressure]);

    if (!this.isIdle) {
      this.gameObject.room.visual.text(
        this.gameObject.spawning.name + '🛠️',
        this.gameObject.pos.x - 1,
        this.gameObject.pos.y,
        {align: 'right', opacity: 0.8});

      this.gameObject.memory['ticksIdle'] = 0;
      return;
    }

    if (this.energy >= minEnergy) {
      let request = this.getNextRequest(TOPIC_SPAWN);
      if (request) {
        // Allow request to override energy limit
        if (request.details.energyLimit) {
          energyLimit = request.details.energyLimit
        }

        this.createCreep(request.details.role, request.details.memory, energyLimit);
        return;
      }

      const peek = this.getKingdom().peekNextRequest(TOPIC_SPAWN);
      if (peek) {
        const role = peek.details.role;
        const definition = definitions[role];
        if (definition.energyMinimum && this.energy < definition.energyMinimum) {
          return;
        }
      }

      // Check inter-colony requests if the colony has spawns
      request = this.getKingdom().getNextRequest(TOPIC_SPAWN);
      if (request) {
        this.createCreep(request.details.role, request.details.memory, energyLimit);
        return;
      }
    }

    // Track how long we sit without something to do (no requests or no energy)
    this.gameObject.memory['ticksIdle']++;

    this.updateStats();
  }
  createCreep(role, memory, energyLimit) {
    const energy = this.energy;
    return creepHelpers.createCreep(this.getColony().id, this.roomId, this.gameObject,
      role, memory, energy, energyLimit);
  }
  getSpawning() {
    return this.gameObject.spawning;
  }
  toString() {
    return `-- Spawner - ID: ${this.id}, Idle: ${this.isIdle}, Energy: ${this.energy}, ` +
      `%Energy: ${this.energyPercentage.toFixed(2)}`;
  }
  updateStats() {
    const spawn = this.gameObject;

    const stats = this.getStats();
    stats.spawns[this.id] = {
      ticksIdle: spawn.memory['ticksIdle'],
    };
  }
}

module.exports = Spawner;
