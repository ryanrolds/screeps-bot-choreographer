import {BaseConfig, ShardConfig} from './config';
import * as MEMORY from './constants.memory';
import {CostMatrixCache} from './lib.costmatrix_cache';
import {EventBroker} from './lib.event_broker';
import {getPath} from './lib.pathing';
import {PathCache} from './lib.path_cache';
import {Request, RequestDetails, TopicKey, Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {OrgBase} from './org.base';
import {Colony} from './org.colony';
import ResourceGovernor from './org.resource_governor';
import OrgRoom from './org.room';
import {Scheduler} from './os.scheduler';
import {thread, ThreadFunc} from './os.thread';
import {CentralPlanning} from './runnable.central_planning';
import WarManager from './runnable.manager.war';
import {Scribe} from './runnable.scribe';

const UPDATE_ORG_TTL = 1;

export class Kingdom extends OrgBase {
  config: ShardConfig; // deprecated
  shardConfig: ShardConfig
  scheduler: Scheduler;
  broker: EventBroker;
  topics: Topics;
  planner: CentralPlanning;

  stats: any; // TODO

  colonies: Record<string, Colony>;
  roomNameToOrgRoom: Record<string, OrgRoom>;
  creeps: Creep[];
  creepsByRoom: Record<string, Creep[]>;
  creepsByBase: Record<string, Creep[]>;
  creepCountsByBaseAndRole: Record<string, Record<string, Creep[]>>;

  resourceGovernor: ResourceGovernor;
  scribe: Scribe;
  pathCache: PathCache;
  costMatrixCache: CostMatrixCache;

  threadUpdateOrg: ThreadFunc;

  constructor(config: ShardConfig, scheduler: Scheduler, scribe: Scribe, topics: Topics, broker: EventBroker,
    planner: CentralPlanning, trace: Tracer) {
    super(null, 'kingdom', trace);

    const setupTrace = this.trace.begin('constructor');

    this.config = config;
    this.shardConfig = config;
    this.scheduler = scheduler;
    this.scribe = scribe;;
    this.broker = broker;
    this.planner = planner;
    this.topics = topics;

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
    this.creepsByBase = {};
    this.creepCountsByBaseAndRole = {};

    this.threadUpdateOrg = thread('update_org_thread', UPDATE_ORG_TTL)(this.updateOrg.bind(this));

    // TODO move to another process
    this.resourceGovernor = new ResourceGovernor(this, setupTrace);

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

    this.updateCreepsByBaseAndRole(updateTrace);

    // TODO do I still need this? May 2022
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
    return this.creepsByBase[id] || [];
  }

  getBaseCreeps(id: string): Creep[] {
    return this.creepsByBase[id] || [];
  }

  getRoomCreeps(id: string): Creep[] {
    return this.creepsByRoom[id] || [];
  }

  getCreepColony(creep: Creep): Colony {
    const colonyId = creep.memory[MEMORY.MEMORY_BASE];
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
    const orgRoom = this.getRoomByName(creep.room.name);
    if (!orgRoom) {
      return null;
    }

    return orgRoom;
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

  /**
   * @DEPRECATED Use sendRequestV2
   */
  sendRequest(topic: TopicKey, priority: number, details: RequestDetails, ttl: number) {
    this.topics.addRequest(topic, priority, details, ttl);
  }

  sendRequestV2(topic: TopicKey, request: Request) {
    this.topics.addRequestV2(topic, request);
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
    this.creepsByBase = this.creeps.reduce((acc, creep) => {
      const colony = creep.memory[MEMORY.MEMORY_BASE];
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
      trace.notice('adding unknown colony', {id});
      this.colonies[id] = new Colony(this, baseConfigs[id], trace);
    });

    const extraColonyIds = _.difference(orgIds, configIds);
    extraColonyIds.forEach((id) => {
      delete this.colonies[id];
    });
  }

  updateCreepsByBaseAndRole(trace) {
    this.creepCountsByBaseAndRole = _.reduce(Game.creeps, (bases, creep) => {
      const base = creep.memory[MEMORY.MEMORY_BASE]
      if (!base) {
        return bases;
      }

      if (!bases[base]) {
        bases[base] = {};
      }

      const role = creep.memory[MEMORY.MEMORY_ROLE];
      if (!role) {
        return bases;
      }

      if (!bases[base][role]) {
        bases[base][role] = [];
      }

      bases[base][role].push(creep);
      return bases;
    }, {} as Record<string, Record<string, Creep[]>>)
  }

  getCreepsByBaseAndRole(base: string, role: string): Creep[] {
    return _.get(this.creepCountsByBaseAndRole, [base, role], []);
  }
}
