const OrgBase = require('./org.base');
const Colony = require('./org.colony');
const WarParty = require('./org.warparty');
const ResourceGovernor = require('./org.resource_governor');
const Scribe = require('./org.scribe');
const Topics = require('./lib.topics');
const PathCache = require('./lib.path_cache');

const {doEvery} = require('./lib.scheduler');

const helpersCreeps = require('./helpers.creeps');
const MEMORY = require('./constants.memory');


const UPDATE_ORG_TTL = 1;
const SAVE_PATH_CACHE_TTL = 100;

class Kingdom extends OrgBase {
  constructor(config, trace) {
    super(null, 'kingdom', trace);

    const setupTrace = this.trace.begin('constructor');

    this.config = config;
    this.topics = new Topics();

    this.colonies = {};
    this.creeps = [];
    this.doUpdateOrg = doEvery(UPDATE_ORG_TTL)((trace) => {
      this.updateOrg(trace);
    });

    this.warParties = {};

    this.resourceGovernor = new ResourceGovernor(this, setupTrace);

    this.scribe = new Scribe(this, setupTrace);

    this.pathCache = new PathCache(this, 250);
    // this.pathCache.loadFromMemory(setupTrace);
    // this.doStoreSavePathCacheToMemory = doEvery(SAVE_PATH_CACHE_TTL)((trace) => {
    //  this.pathCache.saveToMemory(trace);
    // });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.topics.removeStale();

    this.stats = {
      colonies: {},
      sources: {},
      spawns: {},
      pathCache: {},
    };

    this.doUpdateOrg(updateTrace);

    console.log(this);

    const partiesTrace = updateTrace.begin('warparty');
    Object.values(this.warParties).forEach((party) => {
      party.update(partiesTrace);
    });
    partiesTrace.end();

    const coloniesTrace = updateTrace.begin('colonies');
    Object.values(this.colonies).forEach((colony) => {
      colony.update(coloniesTrace);
    });
    coloniesTrace.end();

    const resourceGovTrace = updateTrace.begin('resource_governor');
    this.resourceGovernor.update(resourceGovTrace);
    resourceGovTrace.end();

    const scribeTrace = updateTrace.begin('scribe');
    this.scribe.update(scribeTrace);
    scribeTrace.end();

    // this.doStoreSavePathCacheToMemory(updateTrace);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    const partiesTrace = processTrace.begin('warparty');
    Object.values(this.warParties).forEach((party) => {
      party.process(partiesTrace);
    });
    partiesTrace.end();

    const coloniesTrace = processTrace.begin('colonies');
    Object.values(this.colonies).forEach((colony) => {
      colony.process(coloniesTrace);
    });
    coloniesTrace.end();

    const resourceGovTrace = processTrace.begin('resource_governor');
    this.resourceGovernor.process(resourceGovTrace);
    resourceGovTrace.end();

    const scribeTrace = processTrace.begin('scribe');
    this.scribe.process(scribeTrace);
    scribeTrace.end();

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
  getParent() {
    return this;
  }
  getKingdom() {
    return this;
  }
  getResourceGovernor() {
    return this.resourceGovernor;
  }
  getScribe() {
    return this.scribe;
  }
  getPathCache() {
    return this.pathCache;
  }
  getColonies() {
    return Object.values(this.colonies);
  }
  getColonyById(colonyId) {
    return this.colonies[colonyId];
  }
  getColony() {
    throw new Error('a kingdom is not a colony');
  }
  getRoom() {
    throw new Error('a kingdom is not a room');
  }
  getCreeps() {
    return this.creeps;
  }
  getCreepColony(creep) {
    const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
    if (!colonyId) {
      return null;
    }

    return this.getColonyById(colonyId);
  }
  getCreepAssignedRoom(creep) {
    const colony = this.getCreepColony(creep);
    if (!colony) {
      return null;
    }


    const assignedRoomId = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
    if (!assignedRoomId) {
      return colony.getPrimaryRoom();
    }


    const room = colony.getRoomByID(assignedRoomId);
    if (!room) {
      return null;
    }

    return room;
  }
  getCreepRoom(creep) {
    const colony = this.getCreepColony(creep);
    if (!colony) {
      return null;
    }

    const roomId = creep.room.name;
    if (!roomId) {
      return null;
    }

    const room = colony.getRoomByID(roomId);
    if (!room) {
      return colony.getPrimaryRoom();
    }

    return room;
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

    stats.path_cache = this.getPathCache().getStats();

    stats.credits = Game.market.credits;
  }
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
  getTopics() {
    return this.topics;
  }
  updateOrg(trace) {
    const orgUpdateTrace = trace.begin('update_org');

    this.creeps = _.values(Game.creeps);

    // Colonies
    const configIds = Object.keys(this.config);
    const orgIds = Object.keys(this.colonies);

    const missingColonyIds = _.difference(configIds, orgIds);
    missingColonyIds.forEach((id) => {
      this.colonies[id] = new Colony(this, this.config[id], orgUpdateTrace);
    });

    const extraColonyIds = _.difference(orgIds, configIds);
    extraColonyIds.forEach((id) => {
      delete this.colonies[id];
    });

    // War parties
    const flagIds = Object.keys(Game.flags).filter((id) => {
      return id.startsWith('attack');
    });
    const partyIds = Object.keys(this.warParties);

    const missingFlagIds = _.difference(flagIds, partyIds);
    missingFlagIds.forEach((id) => {
      this.warParties[id] = new WarParty(this, Game.flags[id], orgUpdateTrace);
    });

    const extraFlagIds = _.difference(partyIds, flagIds);
    extraFlagIds.forEach((id) => {
      delete this.warParties[id];
    });

    orgUpdateTrace.end();
  }
}

module.exports = Kingdom;
