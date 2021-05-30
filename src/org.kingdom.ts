import {OrgBase} from './org.base';
import Colony from './org.colony';
import WarParty from './org.warparty';
import ResourceGovernor from './org.resource_governor';
import {Scribe} from './org.scribe';
import {Topics} from './lib.topics';
import PathCache from './lib.path_cache';
import {thread} from './os.thread';
import helpersCreeps from './helpers.creeps';
import MEMORY from './constants.memory';
import * as featureFlags from './lib.feature_flags';
import {KingdomConfig, ShardConfig} from './config';
import {Scheduler} from './os.scheduler';
import {Tracer} from './lib.tracing';
import OrgRoom from './org.room';

const UPDATE_ORG_TTL = 1;

export class Kingdom extends OrgBase {
  config: KingdomConfig;
  scheduler: Scheduler;
  topics: Topics;

  stats: any; // TODO

  colonies: Record<string, Colony>;
  roomNameToOrgRoom: Record<string, OrgRoom>;
  creeps: Creep[];
  warParties: Record<string, WarParty>;

  resourceGovernor: ResourceGovernor;
  scribe: Scribe;
  pathCache: PathCache;
  threadUpdateOrg: any;

  constructor(config: KingdomConfig, scheduler: Scheduler, trace: Tracer) {
    super(null, 'kingdom', trace);

    const setupTrace = this.trace.begin('constructor');

    this.config = config;
    this.scheduler = scheduler;
    this.topics = new Topics();

    this.stats = {
      colonies: {},
      sources: {},
      spawns: {},
      pathCache: {},
      scheduler: {},
      defense: {},
    };

    this.colonies = {};
    this.roomNameToOrgRoom = {};
    this.creeps = [];

    this.threadUpdateOrg = thread(UPDATE_ORG_TTL, null, null)((trace) => {
      this.updateOrg(trace);
    });

    this.warParties = {};

    this.resourceGovernor = new ResourceGovernor(this, setupTrace);

    this.scribe = new Scribe(this, setupTrace);

    this.pathCache = new PathCache(this, 250);
    // this.pathCache.loadFromMemory(setupTrace);
    // this.threadStoreSavePathCacheToMemory = thread(SAVE_PATH_CACHE_TTL)((trace) => {
    //  this.pathCache.saveToMemory(trace);
    // });

    setupTrace.end();
  }
  update(trace: Tracer) {
    const updateTrace = trace.begin('update');

    this.topics.removeStale();

    this.stats = {
      colonies: {},
      sources: {},
      spawns: {},
      pathCache: {},
      scheduler: {},
      defense: {},
    };

    this.threadUpdateOrg(updateTrace);

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

    // this.threadStoreSavePathCacheToMemory(updateTrace);

    updateTrace.end();
  }
  process(trace: Tracer) {
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

    const useCreepManager = featureFlags.getFlag(featureFlags.CREEPS_USE_MANAGER);
    if (!useCreepManager) {
      const creepsTrace = processTrace.begin('creeps');
      helpersCreeps.tick(this, creepsTrace);
      creepsTrace.end();
    }

    processTrace.end();
  }
  getParent(): Kingdom {
    return this;
  }
  getKingdom(): Kingdom {
    return this;
  }
  getFriends(): string[] {
    return this.config.friends;
  }
  getAvoid(): string[] {
    return this.config.avoid;
  }
  getKOS(): string[] {
    return this.config.kos;
  }
  getShardConfig(shardName: string): ShardConfig {
    return this.config.shards[shardName] || null;
  }
  getResourceGovernor(): ResourceGovernor {
    return this.resourceGovernor;
  }
  getScribe(): Scribe {
    return this.scribe;
  }
  getPathCache(): PathCache {
    return this.pathCache;
  }
  getColonies(): Colony[] {
    return Object.values(this.colonies);
  }
  getColonyById(colonyId: string): Colony {
    return this.colonies[colonyId];
  }
  getColony() {
    throw new Error('a kingdom is not a colony');
  }
  getRoom() {
    throw new Error('a kingdom is not a room');
  }
  getRoomColony(roomName: string): Colony {
    return _.find(this.colonies, (colony) => {
      return colony.desiredRooms.indexOf(roomName) > -1;
    });
  }
  getRoomByName(name: string): OrgRoom {
    return this.roomNameToOrgRoom[name] || null;
  }
  getCreeps(): Creep[] {
    return this.creeps;
  }
  getCreepColony(creep: Creep): Colony {
    const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
    if (!colonyId) {
      return null;
    }

    return this.getColonyById(colonyId);
  }
  getCreepAssignedRoom(creep: Creep): OrgRoom {
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
  getCreepRoom(creep: Creep): OrgRoom {
    const colony = this.getCreepColony(creep);
    if (!colony) {
      return null;
    }

    const roomId = creep.room?.name;
    if (!roomId) {
      return null;
    }

    const room = colony.getRoomByID(roomId);
    if (!room) {
      return colony.getPrimaryRoom();
    }

    return room;
  }
  getScheduler(): Scheduler {
    return this.scheduler;
  }
  getStats(): any {
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
      return creep.memory[MEMORY.MEMORY_ROLE];
    });

    stats.topics = this.topics.getCounts();

    stats.path_cache = this.getPathCache().getStats();

    stats.credits = Game.market.credits;
  }
  sendRequest(topic: string, priority: number, request, ttl: number) {
    this.topics.addRequest(topic, priority, request, ttl);
  }
  getNextRequest(topic: string): any {
    return this.topics.getNextRequest(topic);
  }
  peekNextRequest(topic: string): any {
    return this.topics.peekNextRequest(topic);
  }
  getTopicLength(topic: string): number {
    return this.topics.getLength(topic);
  }
  getTopics(): Topics {
    return this.topics;
  }
  getFilteredRequests(topicId, filter): any[] {
    return this.topics.getFilteredRequests(topicId, filter);
  }
  updateOrg(trace: Tracer) {
    const orgUpdateTrace = trace.begin('update_org');

    this.creeps = _.values(Game.creeps);

    const shardConfig = this.getShardConfig(Game.shard.name);
    if (!shardConfig) {
      return;
    }

    // Colonies
    const configIds = Object.keys(shardConfig);
    const orgIds = Object.keys(this.colonies);

    const missingColonyIds = _.difference(configIds, orgIds);
    missingColonyIds.forEach((id) => {
      this.colonies[id] = new Colony(this, shardConfig[id], orgUpdateTrace);
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
