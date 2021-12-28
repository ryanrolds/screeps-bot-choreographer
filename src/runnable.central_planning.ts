import {ColonyConfig, KingdomConfig, ShardConfig} from "./config";
import {pickExpansion} from "./lib.expand";
import {findNextRemoteRoom} from "./lib.remote_room";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {Process, sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import {ColonyManager} from "./runnable.manager.colony";

const RUN_TTL = 50;
const REMOTE_MINING_TTL = 100;
const EXPAND_TTL = 250;
const MIN_DISTANCE_FOR_ORIGIN = 7;

export class CentralPlanning {
  private config: KingdomConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private colonyConfigs: Record<string, ColonyConfig>;
  private roomByColonyId: Record<string, string>;
  private remoteMiningIterator: Generator<any, void, {kingdom: Kingdom, trace: Tracer}>;
  private remoteMiningThread: ThreadFunc;
  private expandColoniesThread: ThreadFunc;

  constructor(config: KingdomConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.colonyConfigs = {};
    this.roomByColonyId = {};

    this.shards.push(Game.shard.name);

    let colonies: ShardConfig = {};
    if ((Memory as any).colonies) {
      trace.notice('found shard memory', {colonies: (Memory as any).colonies});
      colonies = (Memory as any).colonies;
    } else if (config && config.shards && config.shards[Game.shard.name]) {
      trace.notice('found shard config', {config});
      colonies = config.shards[Game.shard.name];
    } else {
      trace.notice('no shard config found, bootstraping?');
    }

    // Setup known colonies
    Object.values(colonies).forEach((colony) => {
      trace.notice('setting up colony', {colony});
      this.addColonyConfig(colony.id, colony.isPublic, colony.origin, colony.automated,
        colony.rooms, trace);
    });

    // Check for spawns without colonies
    Object.values(Game.spawns).forEach((spawn) => {
      const roomName = spawn.room.name;
      const origin = new RoomPosition(spawn.pos.x, spawn.pos.y + 4, spawn.pos.roomName);
      if (!this.colonyConfigs[roomName]) {
        trace.notice('found spawn without colony', {roomName});
        this.addColonyConfig(roomName, false, origin, true, [], trace);
      }
    });

    trace.notice('colony configs', {colonyConfigs: this.colonyConfigs});

    this.remoteMiningIterator = this.remoteMiningGenerator();
    this.remoteMiningThread = thread('remote_mining', REMOTE_MINING_TTL)((trace: Tracer, kingdom: Kingdom) => {
      this.remoteMiningIterator.next({kingdom, trace});
    });

    // TODO make this an iterator
    this.expandColoniesThread = thread('expand', EXPAND_TTL)(this.expandColonies.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Colony manager
    const colonyManagerId = 'colony_manager';
    if (!this.scheduler.hasProcess(colonyManagerId)) {
      const colonyManager = new ColonyManager(colonyManagerId, this, this.scheduler);
      this.scheduler.registerProcess(new Process(colonyManagerId, 'colony_manager',
        Priorities.CRITICAL, colonyManager));
    }

    this.remoteMiningThread(trace, kingdom);
    this.expandColoniesThread(trace, kingdom);

    (Memory as any).colonies = this.colonyConfigs;

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getColonyConfig(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  getColonyConfigs(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigList(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigMap(): Record<string, ColonyConfig> {
    return this.colonyConfigs;
  }

  getColonyConfigById(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  getColonyConfigByRoom(roomName: string): ColonyConfig {
    const colonyId = this.roomByColonyId[roomName];
    if (!colonyId) {
      return null;
    }

    return this.getColonyConfig(colonyId);
  }

  setColonyAutomation(colonyId: string, automated: boolean) {
    this.colonyConfigs[colonyId].automated = automated;
  }

  getUsername() {
    if (!this.username) {
      const spawn = _.first(_.values<StructureSpawn>(Game.spawns));
      if (!spawn) {
        throw new Error('no spawns found');
      }

      this.username = spawn.owner.username;
    }

    return this.username;
  }

  // TODO move to planner
  getFriends(): string[] {
    return this.config.friends;
  }

  getAvoid(): string[] {
    return this.config.avoid;
  }

  getKOS(): string[] {
    return this.config.kos;
  }

  addColonyConfig(primaryRoom: string, isPublic: boolean, origin: RoomPosition, automated: boolean,
    rooms: string[], trace: Tracer) {
    if (this.colonyConfigs[primaryRoom]) {
      trace.error('colony already exists', {primaryRoom});
      return;
    }

    this.colonyConfigs[primaryRoom] = {
      id: primaryRoom,
      isPublic: isPublic,
      primary: primaryRoom,
      rooms: [],
      automated: automated,
      origin: origin,
      parking: new RoomPosition(origin.x + 4, origin.y, origin.roomName),
    };

    this.roomByColonyId[primaryRoom] = primaryRoom;

    // Add colony room
    this.addRoom(primaryRoom, primaryRoom, trace);

    // Add any additional rooms
    rooms.forEach((roomName) => {
      this.addRoom(primaryRoom, roomName, trace)
    });
  }

  removeColony(colonyId: string, trace: Tracer) {
    const colonyConfig = this.getColonyConfig(colonyId);
    const rooms = colonyConfig.rooms;
    rooms.forEach((roomName) => {
      this.removeRoom(roomName, trace);
    });

    delete this.colonyConfigs[colonyId];
  }

  addRoom(colonyId: string, roomName: string, trace: Tracer) {
    trace.notice('adding room', {colonyId, roomName});

    const colonyConfig = this.getColonyConfig(colonyId);
    if (!colonyConfig) {
      trace.error('no colony found', {roomName});
      return;
    }
    this.roomByColonyId[roomName] = colonyId;

    if (colonyConfig.rooms.indexOf(roomName) !== -1) {
      trace.error('room already exists', {roomName});
      return;
    }
    colonyConfig.rooms.push(roomName);
  }

  removeRoom(roomName: string, trace: Tracer) {
    trace.notice('removing room', {roomName});

    const colonyConfig = this.getColonyConfigByRoom(roomName);
    colonyConfig.rooms = _.without(colonyConfig.rooms, roomName);
    delete this.roomByColonyId[roomName];
  }

  private expandColonies(trace: Tracer, kingdom: Kingdom) {
    const scribe = kingdom.getScribe();
    const globalColonyCount = scribe.getGlobalColonyCount();
    if (!globalColonyCount) {
      trace.notice('do not know global colony count yet');
      return;
    }

    const allowedColonies = Game.gcl.level;
    if (globalColonyCount >= allowedColonies) {
      trace.notice('max GCL colonies reached', {globalColonyCount, allowedColonies});
      return;
    }

    const colonyConfigs = this.getColonyConfigs();
    const numColonies = colonyConfigs.length;
    const shardColonyMax = (this.config.maxColonies || 9999);
    if (numColonies >= shardColonyMax) {
      trace.notice('max config colonies reached', {numColonies, shardColonyMax});
      return;
    }

    const results = pickExpansion(kingdom, trace);
    if (results.selected) {
      const roomName = results.selected;
      const distance = results.distance;
      const origin = results.origin;
      trace.log('selected room, adding colony', {roomName, distance, origin});
      this.addColonyConfig(roomName, false, origin, true, [], trace);
      return;
    }

    trace.log('no expansion selected');
  }

  private remoteMining(kingdom: Kingdom, colonyId: string, trace: Tracer) {
    trace.log('remote mining', {colonyId});

    const colonyConfig = this.getColonyConfigById(colonyId);
    const nextRemote = findNextRemoteRoom(kingdom, colonyConfig, trace);

    if (!nextRemote) {
      trace.notice('no remote room found', {colonyId});
      return;
    }

    trace.notice('adding remote', {room: nextRemote, colonyConfig});
    this.addRoom(colonyConfig.id, nextRemote, trace);
  }

  private * remoteMiningGenerator(): Generator<any, void, {kingdom: Kingdom, trace: Tracer}> {
    let colonies: string[] = []
    while (true) {
      const details: {kingdom: Kingdom, trace: Tracer} = yield;
      const kingdom = details.kingdom;
      const trace = details.trace;

      if (!colonies.length) {
        colonies = this.getColonyConfigs().map((colony) => colony.id);
      }

      const colony = colonies.shift();
      if (colony) {
        this.remoteMining(kingdom, colony, trace);
      }
    }
  }
}

