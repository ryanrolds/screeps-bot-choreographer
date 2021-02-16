const OrgBase = require('./org.base');
const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');
const {WORKER_ATTACKER} = require('./constants.creeps');
const {PRIORITY_ATTACKER} = require('./constants.priorities');
const {doEvery} = require('./lib.scheduler');

const DESIRED_NUM_ATTACKERS = 4;
const REQUEST_ATTACKER_TTL = 55;

const FORMATION = [
  {x: -1, y: 1},
  {x: 0, y: 1},
  {x: -1, y: 0},
  {x: 0, y: 0},
];

class WarParty extends OrgBase {
  constructor(parent, flag, trace) {
    super(parent, flag.name, trace);

    const setupTrace = this.trace.begin('constructor');

    this.flag = flag;

    // Check if party needs creeps
    this.doRequestAttackers = doEvery(REQUEST_ATTACKER_TTL)((party) => {
      this.requestAttackers();
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    if (Game.flags[this.id]) {
      this.flag = Game.flags[this.id];
    }

    // was in constructor
    const flag = this.flag;
    const parent = this.parent;

    this.roomId = flag.room && flag.room.name || 'unknown';
    this.creeps = Object.values(parent.getCreeps()).reduce((creeps, creep) => {
      if (creep.memory[MEMORY.MEMORY_FLAG] === this.id) {
        creeps.push(creep);
      }

      return creeps;
    }, []);

    this.sortedHealth = _.sortBy(this.creeps.filter((creep) => {
      return creep.hits < creep.hitsMax;
    }), (creep) => {
      return creep.hits / creep.hitsMax;
    });

    this.nearbyHostiles = [];
    this.nearbyEnemyStructures = [];
    this.nearbyInvaderCores = [];
    this.nearbyWalls = [];

    if (flag.room) {
      this.nearbyHostiles = flag.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
      this.nearbyInvaderCores = flag.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_INVADER_CORE;
        },
      });
      this.nearbyEnemyStructures = flag.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1);

      const walls = flag.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART;
        },
      });
      this.nearbyWalls = _.sortBy(walls, (structure) => {
        return structure.hits;
      });

      if (this.nearbyWalls.length) {
        console.log('walls', this.nearbyWalls[0].id, this.nearbyWalls[0].hits);
      }
    }

    // was in constructor end

    console.log(this);

    this.creeps.forEach((creep, idx) => {
      creep.memory[MEMORY.MEMORY_ATTACK] = null;
      if (this.nearbyHostiles.length) {
        creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyHostiles[0].id;
      } else if (this.nearbyEnemyStructures.length) {
        creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyEnemyStructures[0].id;
      } else if (this.nearbyInvaderCores.length) {
        creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyInvaderCores[0].id;
      } else if ((!creep.room.controller || !creep.room.controller.my) && this.nearbyWalls.length) {
        creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyWalls[0].id;
      }

      console.log('warparty', this.flag.name, creep.memory[MEMORY.MEMORY_ATTACK]);

      if (this.sortedHealth.length) {
        creep.memory[MEMORY.MEMORY_HEAL] = this.sortedHealth[0].id;
      } else {
        creep.memory[MEMORY.MEMORY_HEAL] = null;
      }

      const x = this.flag.pos.x + FORMATION[idx].x;
      const y = this.flag.pos.y + FORMATION[idx].y;
      creep.memory[MEMORY.MEMORY_POSITION_X] = x;
      creep.memory[MEMORY.MEMORY_POSITION_Y] = y;
      creep.memory[MEMORY.MEMORY_POSITION_ROOM] = this.flag.pos.roomName;
    });

    this.doRequestAttackers(this);

    updateTrace.end();
  }
  process(trace) {

  }
  toString() {
    return `---- War Party - ID: ${this.id}, Room: ${this.roomId}, #Creeps: ${this.creeps.length}`;
  }
  requestAttackers() {
    const partySize = this.creeps.length;
    if (partySize >= DESIRED_NUM_ATTACKERS) {
      return;
    }

    const numToRequest = DESIRED_NUM_ATTACKERS - partySize;
    for (let i = 0; i < numToRequest; i++) {
      this.sendRequest(TOPICS.TOPIC_SPAWN, PRIORITY_ATTACKER, {
        role: WORKER_ATTACKER,
        memory: {
          [MEMORY.MEMORY_FLAG]: this.id,
        },
      }, REQUEST_ATTACKER_TTL);
    }
  }
}

module.exports = WarParty;
