const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const creepHelpers = require('./helpers.creeps');
const {definitions} = require('./constants.creeps');
const MEMORY = require('./constants.memory');
const CREEPS = require('./constants.creeps');
const {doEvery} = require('./lib.scheduler');

const REQUEST_BOOSTS_TTL = 5;

class Spawner extends OrgBase {
  constructor(parent, spawner, trace) {
    super(parent, spawner.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.roomId = spawner.room.name;
    this.spawner = spawner;
    spawner.memory['ticksIdle'] = 0;

    this.doBoostRequest = doEvery(REQUEST_BOOSTS_TTL)((boosts, priority) => {
      this.requestBoosts(boosts, priority);
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    // was constructor
    const spawner = this.spawner = Game.getObjectById(this.id);
    if (!spawner) {
      //console.log(`game object for spawn ${this.id} not found`);
      updateTrace.end();
      return;
    }

    this.isIdle = !spawner.spawning;
    this.energy = spawner.room.energyAvailable;
    this.energyCapacity = spawner.room.energyCapacityAvailable;
    this.energyPercentage = this.energy / this.energyCapacity;

    // was constructor end

    console.log(this);

    if (!this.isIdle) {
      const priority = 50 / spawner.spawning.remainingTime;
      const creep = Game.creeps[spawner.spawning.name];
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      const boosts = CREEPS.definitions[role].boosts;

      if (boosts) {
        this.doBoostRequest(boosts, priority);
      }

      spawner.room.visual.text(
        spawner.spawning.name + '🛠️',
        spawner.pos.x - 1,
        spawner.pos.y,
        {align: 'right', opacity: 0.8},
      );

      spawner.memory['ticksIdle'] = 0;
      return;
    }

    // Spawning a new creep should result in a boost request being sent
    // resetting the TTL when idle accomplishes this
    this.doBoostRequest.reset();

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    if (!this.spawner) {
      //console.log(`game object for spawn ${this.id} not found`);
      updateTrace.end();
      return;
    }

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

      minEnergy = _.max([300, minEnergy]);

      //console.log("spawn", energyLimit, minEnergy, this.energy, spawnTopicBackPressure)

      if (this.energy >= minEnergy) {
        let request = this.getNextRequest(TOPICS.TOPIC_SPAWN);
        if (request) {
          // Allow request to override energy limit
          if (request.details.energyLimit) {
            energyLimit = request.details.energyLimit;
          }

          this.createCreep(request.details.role, request.details.memory, energyLimit);
          processTrace.end();
          return;
        }

        const peek = this.getKingdom().peekNextRequest(TOPICS.TOPIC_SPAWN);
        if (peek) {
          const role = peek.details.role;
          const definition = definitions[role];
          if (definition.energyMinimum && this.energy < definition.energyMinimum) {
            processTrace.end();
            return;
          }
        }

        // Check inter-colony requests if the colony has spawns
        request = this.getKingdom().getTopics().getMessageOfMyChoice(TOPICS.TOPIC_SPAWN, (messages) => {
          let selected = messages.filter((message) => {
            const assignedRoom = message.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
            if (!assignedRoom) {
              return false;
            }

            const distance = Game.map.getRoomLinearDistance(this.getRoom().id, assignedRoom);
            if (distance > 5) {
              return false;
            }

            return true;
          });

          if (!selected.length) {
            return null;
          }

          return selected[0]
        });
        if (request) {
          this.createCreep(request.details.role, request.details.memory, energyLimit);
          processTrace.end();
          return;
        }
      }

      // Track how long we sit without something to do (no requests or no energy)
      this.spawner.memory['ticksIdle']++;
    }

    processTrace.end();
  }
  createCreep(role, memory, energyLimit) {
    const energy = this.energy;
    return creepHelpers.createCreep(this.getColony().id, this.roomId, this.spawner,
      role, memory, energy, energyLimit);
  }
  getSpawning() {
    return this.spawner.spawning;
  }
  toString() {
    return `-- Spawner - ID: ${this.id}, Idle: ${this.isIdle}, Energy: ${this.energy}, ` +
      `%Energy: ${this.energyPercentage.toFixed(2)}`;
  }
  updateStats() {
    const spawn = this.spawner;

    const stats = this.getStats();
    const spawnerStats = {
      isSpawning: this.isIdle ? 0 : 1,
      ticksIdle: spawn.memory['ticksIdle'],
    };

    stats.colonies[this.getColony().id].spawner[this.id] = spawnerStats;
  }
  requestBoosts(boosts, priority) {
    this.getColony().sendRequest(TOPICS.BOOST_PREP, priority, {
      [MEMORY.TASK_ID]: `bp-${this.id}-${Game.time}`,
      [MEMORY.PREPARE_BOOSTS]: boosts,
    }, REQUEST_BOOSTS_TTL);
  }
}

module.exports = Spawner;
