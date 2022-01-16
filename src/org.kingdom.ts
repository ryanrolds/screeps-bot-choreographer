import {OrgBase} from './org.base';
import {Colony} from './org.colony';
import ResourceGovernor from './org.resource_governor';
import {Scribe} from './org.scribe';
import {Topics} from './lib.topics';
import {PathCache} from './lib.path_cache';
import {thread, ThreadFunc} from './os.thread';
import * as MEMORY from './constants.memory';
import {BaseConfig, KingdomConfig, ShardConfig} from './config';
import {Scheduler} from './os.scheduler';
import {Tracer} from './lib.tracing';
import OrgRoom from './org.room';
import WarManager from './runnable.manager.war';
import {CostMatrixCache} from './lib.costmatrix_cache';
import {getPath} from './lib.pathing';
import {EventBroker} from './lib.event_broker';
import {CentralPlanning} from './runnable.central_planning';

const UPDATE_ORG_TTL = 1;

export class Kingdom extends OrgBase {
  config: KingdomConfig;
  scheduler: Scheduler;
  broker: EventBroker;
  topics: Topics;
  planner: CentralPlanning;

  stats: any; // TODO

  colonies: Record<string, Colony>;
  roomNameToOrgRoom: Record<string, OrgRoom>;
  creeps: Creep[];
  creepsByRoom: Record<string, Creep[]>;
  creepsByColony: Record<string, Creep[]>;

  resourceGovernor: ResourceGovernor;
  scribe: Scribe;
  pathCache: PathCache;
  costMatrixCache: CostMatrixCache;

  threadUpdateOrg: ThreadFunc;

  constructor(config: KingdomConfig, scheduler: Scheduler, broker: EventBroker,
    planner: CentralPlanning, trace: Tracer) {
    super(null, 'kingdom', trace);

    const setupTrace = this.trace.begin('constructor');

    this.config = config;
    this.scheduler = scheduler;
    this.broker = broker;
    this.planner = planner;
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
    this.creepsByRoom = {};
    this.creepsByColony = {};

    this.threadUpdateOrg = thread('update_org_thread', UPDATE_ORG_TTL)(this.updateOrg.bind(this));

    // TODO move to another process
    this.resourceGovernor = new ResourceGovernor(this, setupTrace);

    this.scribe = new Scribe(this, setupTrace);

    this.pathCache = new PathCache(250, getPath);
    // this.pathCache.loadFromMemory(setupTrace);
    // this.threadStoreSavePathCacheToMemory = thread(SAVE_PATH_CACHE_TTL)((trace) => {
    //  this.pathCache.saveToMemory(trace);
    // });

    this.costMatrixCache = new CostMatrixCache();

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

    const coloniesTrace = updateTrace.begin('colonies');
    Object.values(this.colonies).forEach((colony) => {
      colony.update(coloniesTrace.withFields({colonyId: colony.id}));
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

    processTrace.end();
  }

  getParent(): Kingdom {
    return this;
  }

  getKingdom(): Kingdom {
    return this;
  }

  getBroker(): EventBroker {
    return this.broker;
  }

  getPlanner(): CentralPlanning {
    return this.planner;
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

  getCostMatrixCache(): CostMatrixCache {
    return this.costMatrixCache;
  }

  getWarManager(): WarManager {
    if (!this.scheduler.hasProcess('war_manager')) {
      return null;
    }

    // TODO stop doing this, use a topic
    return this.scheduler.processMap['war_manager'].runnable as WarManager;
  }

  getColonies(): Colony[] {
    return Object.values(this.colonies);
  }

  getColonyById(colonyId: string): Colony {
    return this.colonies[colonyId];
  }

  getClosestColonyInRange(roomName: string, range: Number = 5): Colony {
    let selectedColony = null;
    let selectedColonyDistance = 99999;

    Object.values(this.colonies).forEach((colony) => {
      const distance = Game.map.getRoomLinearDistance(colony.primaryRoomId, roomName)
      if (distance <= range && selectedColonyDistance > distance) {
        selectedColony = colony;
        selectedColonyDistance = distance;
      }
    })

    return selectedColony;
  }

  getRoom(): OrgRoom {
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

  getColonyCreeps(id: string): Creep[] {
    return this.creepsByColony[id] || [];
  }

  getRoomCreeps(id: string): Creep[] {
    return this.creepsByRoom[id] || [];
  }

  getCreepColony(creep: Creep): Colony {
    const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
    if (!colonyId) {
      return null;
    }

    return this.getColonyById(colonyId);
  }

  getCreepBaseConfig(creep: Creep): BaseConfig {
    const colony = this.getCreepColony(creep);
    if (!colony) {
      return null;
    }

    return this.getPlanner().getBaseConfig(colony.id);
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
  updateStats(trace: Tracer) {
    const stats = this.getStats();

    stats.time = Game.time;

    // Collect GCL stats
    stats.gcl = {};
    stats.gcl.progress = Game.gcl.progress;
    stats.gcl.progressTotal = Game.gcl.progressTotal;
    stats.gcl.level = Game.gcl.level;

    stats.creeps = _.countBy(Game.creeps, (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE];
    });

    stats.topics = this.topics.getCounts();

    stats.streams = this.getBroker().getStats();

    stats.path_cache = this.getPathCache().getStats(trace);

    stats.scribe = this.getScribe().getStats();

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
    this.creeps = _.values(Game.creeps);

    const roomCreepsTrace = trace.begin('room_creeps');
    this.updateRoomCreeps(roomCreepsTrace);
    roomCreepsTrace.end();

    const colonyCreepsTrace = trace.begin('colony_creeps');
    this.updateColonyCreeps(colonyCreepsTrace);
    colonyCreepsTrace.end();

    const updateColoniesTrace = trace.begin('colony_colonies');
    this.updateColonies(updateColoniesTrace);
    updateColoniesTrace.end();
  }

  updateRoomCreeps(trace: Tracer) {
    this.creepsByRoom = this.creeps.reduce((acc, creep) => {
      let room = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      if (!room) {
        return acc;
      }

      if (!acc[room]) {
        acc[room] = [];
      }

      acc[room].push(creep);

      return acc;
    }, {} as Record<string, Creep[]>);
  }

  updateColonyCreeps(trace: Tracer) {
    this.creepsByColony = this.creeps.reduce((acc, creep) => {
      const colony = creep.memory[MEMORY.MEMORY_COLONY];
      if (!colony) {
        return acc;
      }

      if (!acc[colony]) {
        acc[colony] = [];
      }

      acc[colony].push(creep);

      return acc;
    }, {} as Record<string, Creep[]>);
  }

  // TODO replace all need for Colony with IPC
  updateColonies(trace: Tracer) {
    const baseConfigs = this.getPlanner().getBaseConfigMap();
    trace.log('update colonies', {baseConfigs});

    // Colonies
    const configIds = _.reduce(baseConfigs, (acc, config) => {
      return acc.concat(config.id);
    }, [] as string[]);

    const orgIds = Object.keys(this.colonies);

    const missingColonyIds = _.difference(configIds, orgIds);
    missingColonyIds.forEach((id) => {
      trace.notice('adding missing colony', {id});
      this.colonies[id] = new Colony(this, baseConfigs[id], trace);
    });

    const extraColonyIds = _.difference(orgIds, configIds);
    extraColonyIds.forEach((id) => {
      delete this.colonies[id];
    });
  }
}
