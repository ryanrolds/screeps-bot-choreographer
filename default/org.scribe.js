const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const PRIORITIES = require('./constants.priorities');
const {doEvery} = require('./lib.scheduler');

const MEMORY_JOURNAL = 'scribe_journal';

class Scribe extends OrgBase {
  constructor(parent, trace) {
    super(parent, 'scribe', trace);

    const setupTrace = this.trace.begin('constructor');

    if (!Memory[MEMORY_JOURNAL]) {
      Memory[MEMORY_JOURNAL] = {
        rooms: {},
      };
    }

    this.journal = Memory[MEMORY_JOURNAL];

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.journal = Memory[MEMORY_JOURNAL];

    // console.log(this);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    this.updateStats();

    processTrace.end();
  }
  toString() {
    return `** Scribe - Rooms: ${Object.keys(this.journal.rooms).length}`;
  }
  removeStaleJournalEntries() {

  }
  updateStats() {

  }
  updateRoom(roomObject) {
    const room = {
      id: roomObject.name,
      lastUpdated: Game.time,
    };

    room.controller = null;
    if (roomObject.controller) {
      let owner = null;
      if (roomObject.controller.owner) {
        owner = roomObject.controller.owner.username;
      }

      room.controller = {
        owner: owner,
        level: roomObject.controller.level,
        safeModeAvailable: roomObject.controller.safeModeAvailable,
      };
    }

    room.numSources = roomObject.find(FIND_SOURCES).length;
    room.hasHostiles = roomObject.find(FIND_HOSTILE_CREEPS).length > 0;

    room.numTowers = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER;
      },
    }).length;

    room.mineral = null;
    const minerals = roomObject.find(FIND_MINERALS);
    if (minerals.length) {
      room.mineral = minerals[0].mineralType;
    }

    room.portals = [];
    const portals = roomObject.find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_PORTAL;
      },
    });
    room.portals = portals.map((portal) => {
      return {
        shard: portal.shard,
        room: portal.room,
      };
    });

    room.powerBank = roomObject.find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_POWER_BANK;
      },
    }).length > 0;

    room.deposits = roomObject.find(FIND_DEPOSITS).map((deposit) => {
      return {
        type: deposit.depositType,
        cooldown: deposit.cooldown,
        ttl: deposit.ticksToDecay,
      };
    });

    this.journal.rooms[room.id] = room;
  }
  getRoom(roomId) {
    return this.journal.rooms[roomId] || null;
  }
}

module.exports = Scribe;
