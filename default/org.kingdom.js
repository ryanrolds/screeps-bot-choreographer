const OrgBase = require('./org.base');
const Colony = require('./org.colony');
const WarParty = require('./org.warparty');
const ResourceGovernor = require('./org.resource_governor');
const Topics = require('./lib.topics');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const helpersCreeps = require('./helpers.creeps');
const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');
const TASKS = require('./constants.tasks');

const UPDATE_ORG_TTL = 1;

class Kingdom extends OrgBase {
  constructor(config, trace) {
    super(null, 'kingdom', trace);

    const setupTrace = this.trace.begin('constructor');

    this.config = config;
    this.colonies = {};
    this.warParties = {};
    this.topics = new Topics();

    this.doUpdateOrg = doEvery(UPDATE_ORG_TTL)((trace) => {
      this.updateOrg(trace)
    })

    this.resourceGovernor = new ResourceGovernor(this, setupTrace);

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.topics.reset();
    } else {
      this.topics.removeStale();
    }

    // was constructor
    this.stats = {
      rooms: {}, // DEPRECATED, use colonies
      colonies: {},
      sources: {},
      spawns: {},
    };

    this.creeps = _.values(Game.creeps);

    // was constructor end

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.updateOrg(updateTrace)
    } else {
      this.doUpdateOrg(updateTrace)
    }

    console.log(this);
    //console.log(JSON.stringify(this.topics))

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
    return `---- Kingdom - #Colonies: ${Object.keys(this.colonies).length}`;
  }
  // Request handling
  sendRequest(topic, priority, request, ttl) {
    this.topics.addRequest(topic, priority, request, ttl);
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
  getResourceGovernor() {
    return this.resourceGovernor;
  }
  getColonies() {
    return Object.values(this.colonies);
  }
  getColony() {
    throw new Error('a kingdom is not a colony');
  }
  getColonyById(colonyId) {
    return this.colonies[colonyId];
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
    return Object.values(this.colonies).reduce((acc, colony) => {
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
    return Object.values(this.colonies).reduce((acc, colony) => {
      return acc + colony.getAmountInReserve(resource);
    }, 0);
  }
  getReactors() {
    return this.getColonies().reduce((acc, colony) => {
      const room = colony.getPrimaryRoom();
      if (!room) {
        return acc;
      }

      // If colony doesn't have a terminal don't include it
      if (!Object.keys(room.reactorMap).length) {
        return acc;
      }

      return acc.concat(Object.values(room.reactorMap));
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
  updateOrg(trace) {
    // Colonies
    const configIds = Object.keys(this.config)
    const orgIds = Object.keys(this.colonies)

    const missingColonyIds = _.difference(configIds, orgIds)
    missingColonyIds.forEach((id) => {
      this.colonies[id] = new Colony(this, this.config[id], trace)
    })

    const extraColonyIds = _.difference(orgIds, configIds)
    extraColonyIds.forEach((id) => {
      delete this.colonies[id]
    })

    // War parties
    const flagIds = Object.keys(Game.flags).filter((id) => {
      return id.startsWith('attack')
    })
    const partyIds = Object.keys(this.warParties)

    const missingFlagIds = _.difference(flagIds, partyIds)
    missingFlagIds.forEach((id) => {
      this.warParties[id] = new WarParty(this, Game.flags[id], trace)
    });

    const extraFlagIds = _.difference(partyIds, flagIds)
    extraFlagIds.forEach((id) => {
      delete this.warParties[id]
    });
  }
}

module.exports = Kingdom;
