const OrgBase = require('./org.base');
const Colony = require('./org.colony');
const WarParty = require('./org.warparty');
const ResourceGovernor = require('./org.resource_governor');
const Topics = require('./lib.topics');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const helpersCreeps = require('./helpers.creeps');
const MEMORY = require('./constants.memory');

class Kingdom extends OrgBase {
  constructor(config, trace) {
    super(null, 'kingdom', trace);

    const setupTrace = this.trace.begin('constructor');

    this.config = config;
    this.colonies = {};
    this.warParties = {};
    this.topics = new Topics();

    this.resourceGovernor = new ResourceGovernor(this, setupTrace);

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
      this.topics.reset();
    }

    // was constructor
    this.stats = {
      rooms: {}, // DEPRECATED, use colonies
      colonies: {},
      sources: {},
      spawns: {},
    };

    this.creeps = _.values(Game.creeps);

    this.colonyIdMap = {};
    this.colonies = Object.values(this.config).map((colony) => {
      const orgColony = new Colony(this, colony, updateTrace);
      this.colonyIdMap[colony.id] = orgColony;
      return orgColony;
    });

    this.warParties = Object.values(Game.flags).reduce((parties, flag) => {
      if (flag.name.startsWith('attack')) {
        parties[flag.name] = new WarParty(this, flag, updateTrace);
      }

      return parties;
    }, {});
    // was constructor end

    console.log(this);

    Object.values(this.warParties).forEach((party) => {
      party.update();
    });

    Object.values(this.colonies).forEach((colony) => {
      colony.update();
    });

    this.resourceGovernor.update();

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    Object.values(this.warParties).forEach((party) => {
      party.process();
    });

    Object.values(this.colonies).forEach((colony) => {
      colony.process();
    });

    this.resourceGovernor.process();

    const creepsTrace = processTrace.begin('creeps');
    helpersCreeps.tick(this, creepsTrace);
    creepsTrace.end();

    this.updateStats();

    // Set stats in memory for pulling and display in Grafana
    Memory.stats = this.getStats();

    processTrace.end();
  }
  toString() {
    return `---- Kingdom - #Colonies: ${this.colonies.length}`;
  }
  // Request handling
  sendRequest(topic, priority, request) {
    this.topics.addRequest(topic, priority, request);
  }
  getNextRequest(topic) {
    return this.topics.getNextRequest(topic);
  }
  peekNextRequest(topic) {
    return this.topics.peekNextRequest(topic);
  }
  getTopicLength(topic) {
    return this.topics.getLength(topic);
  }
  getKingdom() {
    return this;
  }
  getColonies() {
    return this.colonies;
  }
  getColony() {
    throw new Error('a kingdom is not a colony');
  }
  getColonyById(colonyId) {
    return this.colonyIdMap[colonyId];
  }
  getRoom() {
    throw new Error('a kingdom is not a room');
  }
  getCreeps() {
    return this.creeps;
  }
  getCreepRoom(creep) {
    const colony = this.getCreepColony(creep);
    if (!colony) {
      return null;
    }

    const roomId = creep.room.name;
    return colony.getRoomByID(roomId);
  }
  getCreepColony(creep) {
    const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
    if (!colonyId) {
      return null;
    }

    return this.getColonyById(colonyId);
  }
  getReserveResources(includeTerminal) {
    return this.colonies.reduce((acc, colony) => {
      // If colony doesn't have a terminal don't include it
      if (!colony.getPrimaryRoom() || !colony.getPrimaryRoom().terminal) {
        return acc;
      }

      const colonyResources = colony.getReserveResources(includeTerminal);
      Object.keys(colonyResources).forEach((resource) => {
        const current = acc[resource] || 0;
        acc[resource] = colonyResources[resource] + current;
      });

      return acc;
    }, {});
  }
  getAmountInReserve(resource) {
    return this.colonies.reduce((acc, colony) => {
      return acc + colony.getAmountInReserve(resource);
    }, 0);
    return this.primaryRoom.getAmountInReserve(resource);
  }
  getTerminalWithResource(resource) {
    const terminals = this.getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      // If colony doesn't have a terminal don't include it
      if (!room.terminal) {
        return acc;
      }

      const amount = colony.getAmountInReserve(resource);
      if (!amount) {
        return acc;
      }

      return acc.concat({terminal: room.getTerminal(), amount});
    }, []);

    return _.sortBy(terminals, 'amount').pop();
  }
  getTerminals() {
    return this.getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      // If colony doesn't have a terminal don't include it
      if (!room.terminal) {
        return acc;
      }

      return acc.concat(room.terminal);
    }, []);
  }
  getReactors() {
    return this.getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!room.reactors.length) {
        return acc;
      }

      return acc.concat(room.reactors);
    }, []);
  }
  getStats() {
    return this.stats;
  }
  updateStats() {
    const stats = this.getStats();

    stats.time = Game.time;

    // Collect GCL stats
    stats.gcl = {};
    stats.gcl.progress = Game.gcl.progress;
    stats.gcl.progressTotal = Game.gcl.progressTotal;
    stats.gcl.level = Game.gcl.level;

    // Collect CPU stats
    stats.cpu = {};
    stats.cpu.bucket = Game.cpu.bucket;
    stats.cpu.limit = Game.cpu.limit;
    stats.cpu.used = Game.cpu.getUsed();

    stats.creeps = _.countBy(Game.creeps, (creep) => {
      return creep.memory.role;
    });

    stats.topics = this.topics.getCounts();

    stats.resources = this.getReserveResources(true);
  }
}

module.exports = Kingdom;
