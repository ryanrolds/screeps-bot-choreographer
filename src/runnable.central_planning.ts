import {BaseConfig, KingdomConfig, ShardConfig} from "./config";
import {pickExpansion} from "./lib.expand";
import {desiredRemotes, findNextRemoteRoom} from "./lib.remote_room";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {Process, sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import BaseRunnable from "./runnable.base";

const RUN_TTL = 50;
const BASE_PROCESSES_TTL = 50;
const REMOTE_MINING_TTL = 100;
const EXPAND_TTL = 250;
const MIN_DISTANCE_FOR_ORIGIN = 7;

export class CentralPlanning {
  private config: KingdomConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private baseConfigs: Record<string, BaseConfig>;
  private roomByBaseId: Record<string, string>;

  private threadBaseProcesses: ThreadFunc;
  private remoteMiningIterator: Generator<any, void, {kingdom: Kingdom, trace: Tracer}>;
  private remoteMiningThread: ThreadFunc;
  private expandColoniesThread: ThreadFunc;

  constructor(config: KingdomConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.baseConfigs = {};
    this.roomByBaseId = {};

    this.shards.push(Game.shard.name);

    let bases: ShardConfig = {};
    if ((Memory as any).colonies) {
      trace.notice('found shard memory', {colonies: (Memory as any).colonies});
      bases = (Memory as any).colonies;
    } else if (config && config.shards && config.shards[Game.shard.name]) {
      trace.notice('found shard config', {config});
      bases = config.shards[Game.shard.name];
    } else {
      trace.notice('no shard config found, bootstraping?');
    }

    // Setup known colonies
    Object.values(bases).forEach((colony) => {
      trace.notice('setting up colony', {colony});
      this.addBaseConfig(colony.id, colony.isPublic, colony.origin, colony.automated,
        colony.rooms, trace);
    });

    // Check for spawns without colonies
    Object.values(Game.spawns).forEach((spawn) => {
      const roomName = spawn.room.name;
      const origin = new RoomPosition(spawn.pos.x, spawn.pos.y + 4, spawn.pos.roomName);
      if (!this.baseConfigs[roomName]) {
        trace.notice('found spawn without colony', {roomName});
        this.addBaseConfig(roomName, false, origin, true, [], trace);
      }
    });

    trace.notice('colony configs', {baseConfigs: this.baseConfigs});

    this.threadBaseProcesses = thread('base_processes', BASE_PROCESSES_TTL)(this.baseProcesses.bind(this));

    this.remoteMiningIterator = this.remoteMiningGenerator();
    this.remoteMiningThread = thread('remote_mining', REMOTE_MINING_TTL)((trace: Tracer, kingdom: Kingdom) => {
      this.remoteMiningIterator.next({kingdom, trace});
    });

    // TODO make this an iterator
    this.expandColoniesThread = thread('expand', EXPAND_TTL)(this.expandColonies.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    this.threadBaseProcesses(trace, kingdom);
    this.remoteMiningThread(trace, kingdom);
    this.expandColoniesThread(trace, kingdom);

    (Memory as any).colonies = this.baseConfigs;
    (Memory as any).bases = this.baseConfigs;

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getBaseConfig(colonyId: string): BaseConfig {
    return this.baseConfigs[colonyId];
  }

  getBaseConfigs(): BaseConfig[] {
    return _.values(this.baseConfigs);
  }

  getBaseConfigList(): BaseConfig[] {
    return _.values(this.baseConfigs);
  }

  getBaseConfigMap(): Record<string, BaseConfig> {
    return this.baseConfigs;
  }

  getBaseConfigById(colonyId: string): BaseConfig {
    return this.baseConfigs[colonyId];
  }

  getBaseConfigByRoom(roomName: string): BaseConfig {
    const baseId = this.roomByBaseId[roomName];
    if (!baseId) {
      return null;
    }

    return this.getBaseConfig(baseId);
  }

  setColonyAutomation(colonyId: string, automated: boolean) {
    this.baseConfigs[colonyId].automated = automated;
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

  addBaseConfig(primaryRoom: string, isPublic: boolean, origin: RoomPosition, automated: boolean,
    rooms: string[], trace: Tracer) {
    if (this.baseConfigs[primaryRoom]) {
      trace.error('colony already exists', {primaryRoom});
      return;
    }

    this.baseConfigs[primaryRoom] = {
      id: primaryRoom,
      isPublic: isPublic,
      primary: primaryRoom,
      rooms: [],
      automated: automated,
      origin: origin,
      parking: new RoomPosition(origin.x + 4, origin.y, origin.roomName),
    };

    this.roomByBaseId[primaryRoom] = primaryRoom;

    // Add colony room
    this.addRoom(primaryRoom, primaryRoom, trace);

    // Add any additional rooms
    rooms.forEach((roomName) => {
      this.addRoom(primaryRoom, roomName, trace)
    });
  }

  removeColony(colonyId: string, trace: Tracer) {
    const baseConfig = this.getBaseConfig(colonyId);
    const rooms = baseConfig.rooms;
    rooms.forEach((roomName) => {
      this.removeRoom(roomName, trace);
    });

    delete this.baseConfigs[colonyId];
  }

  addRoom(colonyId: string, roomName: string, trace: Tracer) {
    trace.notice('adding room', {colonyId, roomName});

    const baseConfig = this.getBaseConfig(colonyId);
    if (!baseConfig) {
      trace.error('no colony found', {roomName});
      return;
    }
    this.roomByBaseId[roomName] = colonyId;

    if (baseConfig.rooms.indexOf(roomName) !== -1) {
      trace.error('room already exists', {roomName});
      return;
    }
    baseConfig.rooms.push(roomName);
  }

  removeRoom(roomName: string, trace: Tracer) {
    trace.notice('removing room', {roomName});

    const baseConfig = this.getBaseConfigByRoom(roomName);
    if (!baseConfig) {
      trace.error('no colony found', {roomName});
      return;
    }

    baseConfig.rooms = _.without(baseConfig.rooms, roomName);
    delete this.roomByBaseId[roomName];

    trace.log('room removed from colony', {colonyId: baseConfig.id, roomName});
  }

  private expandColonies(trace: Tracer, kingdom: Kingdom) {
    const scribe = kingdom.getScribe();
    const globalColonyCount = scribe.getGlobalColonyCount();
    if (!globalColonyCount) {
      trace.log('do not know global colony count yet');
      return;
    }

    const allowedColonies = Game.gcl.level;
    if (globalColonyCount >= allowedColonies) {
      trace.log('max GCL colonies reached', {globalColonyCount, allowedColonies});
      return;
    }

    const baseConfigs = this.getBaseConfigs();
    const numColonies = baseConfigs.length;
    const shardColonyMax = (this.config.maxColonies || 9999);
    if (numColonies >= shardColonyMax) {
      trace.log('max config colonies reached', {numColonies, shardColonyMax});
      return;
    }

    const results = pickExpansion(kingdom, trace);
    if (results.selected) {
      const roomName = results.selected;
      const distance = results.distance;
      const origin = results.origin;
      trace.notice('selected room, adding colony', {roomName, distance, origin});
      this.addBaseConfig(roomName, false, origin, true, [], trace);
      return;
    }

    trace.log('no expansion selected');
  }

  private baseProcesses(trace: Tracer, kingdom: Kingdom) {
    // If any defined colonies don't exist, run it
    const bases = kingdom.getPlanner().getBaseConfigs();
    bases.forEach((colony) => {
      const colonyProcessId = `base_${colony.id}`;
      const hasProcess = this.scheduler.hasProcess(colonyProcessId);
      if (hasProcess) {
        return;
      }

      this.scheduler.registerProcess(new Process(colonyProcessId, 'base', Priorities.CRITICAL,
        new BaseRunnable(colony.id, this.scheduler)));
    });
  }

  private remoteMining(kingdom: Kingdom, baseConfig: BaseConfig, trace: Tracer) {
    trace.log('remote mining', {colonyId: baseConfig.id});

    if (!baseConfig.automated) {
      trace.log('not automated', {baseConfig});
      return null;
    }

    const colony = kingdom.getColonyById(baseConfig.id);
    if (!colony) {
      trace.log('no colony', {baseConfig});
      return null;
    }

    const room = Game.rooms[baseConfig.primary];
    if (!room) {
      trace.log('no room found', {baseConfig});
      return null;
    }

    const level = room?.controller?.level || 0;
    let numDesired = desiredRemotes(colony, level);

    while (baseConfig.rooms.length - 1 > numDesired) {
      trace.notice('more rooms than desired, removing room', {baseConfig});
      this.removeRoom(baseConfig.rooms[baseConfig.rooms.length - 1], trace);
    }

    if (baseConfig.rooms.length - 1 < numDesired) {
      const nextRemote = findNextRemoteRoom(kingdom, baseConfig, room, trace);
      if (!nextRemote) {
        trace.notice('no remote room found', {colonyId: baseConfig.id});
        return;
      }

      trace.notice('adding remote', {room: nextRemote, baseConfig});
      this.addRoom(baseConfig.id, nextRemote, trace);
    }
  }

  private * remoteMiningGenerator(): Generator<any, void, {kingdom: Kingdom, trace: Tracer}> {
    let bases: BaseConfig[] = []
    while (true) {
      const details: {kingdom: Kingdom, trace: Tracer} = yield;
      const kingdom = details.kingdom;
      const trace = details.trace;

      if (!bases.length) {
        bases = this.getBaseConfigs()
      }

      const colony = bases.shift();
      if (colony) {
        this.remoteMining(kingdom, colony, trace);
      }
    }
  }
}

