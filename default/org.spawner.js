const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const creepHelpers = require('./helpers.creeps');
const {definitions} = require('./constants.creeps');
const MEMORY = require('./constants.memory');
const CREEPS = require('./constants.creeps');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const REQUEST_BOOSTS_TTL = 50;

class Spawner extends OrgBase {
  constructor(parent, spawner, trace) {
    super(parent, spawner.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.roomId = spawner.room.name;
    this.spawner = spawner;
    this.gameObject = spawner;
    spawner.memory['ticksIdle'] = 0;

    this.doBoostRequest = doEvery(REQUEST_BOOSTS_TTL)((boosts, priority) => {
      this.requestBoosts(boosts, priority)
    })

    setupTrace.end();
  }
  update() {
    // was constructor
    const spawner = this.spawner;
    this.isIdle = !spawner.spawning;
    this.energy = spawner.room.energyAvailable;
    this.energyCapacity = spawner.room.energyCapacityAvailable;
    this.energyPercentage = this.energy / this.energyCapacity;

    // was constructor end

    console.log(this);

    if (!this.isIdle) {
      const spawn = this.gameObject;
      const priority = 50 / spawn.spawning.remainingTime;
      const creep = Game.creeps[spawn.spawning.name];
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      const boosts = CREEPS.definitions[role].boosts;
      console.log(creep.name, role, JSON.stringify(boosts));

      if (boosts) {
        console.log('sending boost request', JSON.stringify(boosts));

        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestBoosts(boosts, priority)
        } else {
          this.doBoostRequest(boosts, priority)
        }
      }

      spawn.room.visual.text(
        spawn.spawning.name + '🛠️',
        spawn.pos.x - 1,
        spawn.pos.y,
        {align: 'right', opacity: 0.8},
      );

      spawn.memory['ticksIdle'] = 0;
      return;
    }

    // Spawning a new creep should result in a boost request being sent
    // resetting the TTL when idle accomplishes this
    this.doBoostRequest.reset();
  }
  process() {
    this.updateStats();

    if (this.isIdle) {
      const spawnTopicSize = this.getTopicLength(TOPICS.TOPIC_SPAWN);
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

      if (this.energy >= minEnergy) {
        let request = this.getNextRequest(TOPICS.TOPIC_SPAWN);
        if (request) {
          // Allow request to override energy limit
          if (request.details.energyLimit) {
            energyLimit = request.details.energyLimit;
          }

          this.createCreep(request.details.role, request.details.memory, energyLimit);
          return;
        }

        const peek = this.getKingdom().peekNextRequest(TOPICS.TOPIC_SPAWN);
        if (peek) {
          const role = peek.details.role;
          const definition = definitions[role];
          if (definition.energyMinimum && this.energy < definition.energyMinimum) {
            return;
          }
        }

        // Check inter-colony requests if the colony has spawns
        request = this.getKingdom().getNextRequest(TOPICS.TOPIC_SPAWN);
        if (request) {
          this.createCreep(request.details.role, request.details.memory, energyLimit);
          return;
        }
      }

      // Track how long we sit without something to do (no requests or no energy)
      this.gameObject.memory['ticksIdle']++;
    }
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
    const spawnerStats = {
      isSpawning: this.isIdle ? 0 : 1,
      ticksIdle: spawn.memory['ticksIdle'],
    };

    stats.colonies[this.getColony().id].spawner[this.id] = spawnerStats;
  }
  requestBoosts(boosts, priority) {
    this.getColony().sendRequest(TOPICS.BOOST_PREP, priority, {
      [MEMORY.PREPARE_BOOSTS]: boosts,
    }, REQUEST_BOOSTS_TTL);
  }
}

module.exports = Spawner;
