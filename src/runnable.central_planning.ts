import {BaseConfig, BaseMap, ShardConfig} from "./config";
import {pickExpansion} from "./lib.expand";
import {ENTIRE_ROOM_BOUNDS, getCutTiles} from "./lib.min_cut";
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
const BASE_WALLS_TTL = 50;

export class CentralPlanning {
  private config: ShardConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private baseConfigs: Record<string, BaseConfig>;
  private roomByBaseId: Record<string, string>;

  private threadBaseProcesses: ThreadFunc;
  private remoteMiningIterator: Generator<any, void, {kingdom: Kingdom, trace: Tracer}>;
  private remoteMiningThread: ThreadFunc;
  private expandColoniesThread: ThreadFunc;

  private baseWallsIterator: Generator<any, void, {kingdom: Kingdom, trace: Tracer}>;
  private baseWallsThread: ThreadFunc;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.baseConfigs = {};
    this.roomByBaseId = {};

    this.shards.push(Game.shard.name);

    let bases: BaseMap = {};
    if ((Memory as any).bases) {
      trace.warn('found shard memory', {bases: (Memory as any).bases});
      bases = (Memory as any).bases;
    } else if (config && config.bases && config.bases[Game.shard.name]) {
      trace.warn('found shard config', {config});
      bases = config.bases;
    } else {
      trace.warn('no shard config found, bootstraping?');
    }

    // Setup known bases
    Object.values(bases).forEach((base) => {
      trace.notice('setting up base', {base});

      const origin = new RoomPosition(base.origin.x, base.origin.y, base.origin.roomName);
      const parking = new RoomPosition(base.parking.x, base.parking.y, base.parking.roomName);

      this.addBase(base.id, base.isPublic, origin, parking,
        base.automated, base.rooms, base.walls || [], trace);
    });

    // Check for spawns without bases
    Object.values(Game.spawns).forEach((spawn) => {
      const shard = Game.shard.name;
      const roomName = spawn.room.name;
      const origin = new RoomPosition(spawn.pos.x, spawn.pos.y + 4, spawn.pos.roomName);
      trace.notice('checking spawn', {roomName, origin});
      const parking = new RoomPosition(origin.x + 5, origin.y, origin.roomName);
      const automated = !shard.startsWith('shard') || shard === 'shardSeason';
      if (!this.baseConfigs[roomName]) {
        trace.warn('found unknown base', {roomName});
        this.addBase(roomName, false, origin, parking, automated, [], [], trace);
      }
    });

    trace.notice('bases configs', {baseConfigs: this.baseConfigs});

    this.threadBaseProcesses = thread('base_processes', BASE_PROCESSES_TTL)(this.baseProcesses.bind(this));

    this.remoteMiningIterator = this.remoteMiningGenerator();
    this.remoteMiningThread = thread('remote_mining', REMOTE_MINING_TTL)((trace: Tracer, kingdom: Kingdom) => {
      this.remoteMiningIterator.next({kingdom, trace});
    });

    // TODO make this an iterator
    this.expandColoniesThread = thread('expand', EXPAND_TTL)(this.expandColonies.bind(this));

    // Calculate base walls
    this.baseWallsIterator = this.baseWallsGenerator();
    this.baseWallsThread = thread('base_walls', BASE_WALLS_TTL)((trace: Tracer, kingdom: Kingdom) => {
      this.baseWallsIterator.next({kingdom, trace});
    });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    this.threadBaseProcesses(trace, kingdom);
    this.remoteMiningThread(trace, kingdom);
    this.expandColoniesThread(trace, kingdom);
    this.baseWallsThread(trace, kingdom);

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

  addBase(primaryRoom: string, isPublic: boolean, origin: RoomPosition, parking: RoomPosition,
    automated: boolean, rooms: string[], walls: {x: number, y: number}[], trace: Tracer) {
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
      parking: parking,
      walls: walls,
    };

    this.roomByBaseId[primaryRoom] = primaryRoom;

    // Add colony room
    // this.addRoom(primaryRoom, primaryRoom, trace);

    // Add any additional rooms, primary is expected to be first
    rooms.forEach((roomName) => {
      this.addRoom(primaryRoom, roomName, trace)
    });
  }

  removeBase(colonyId: string, trace: Tracer) {
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

  private baseProcesses(trace: Tracer, kingdom: Kingdom) {
    // If any defined colonies don't exist, run it
    const bases = kingdom.getPlanner().getBaseConfigs();
    bases.forEach((base) => {
      const baseProcessId = `base_${base.id}`;
      const hasProcess = this.scheduler.hasProcess(baseProcessId);
      if (hasProcess) {
        return;
      }

      trace.warn('starting base process');

      this.scheduler.registerProcess(new Process(baseProcessId, 'base', Priorities.CRITICAL,
        new BaseRunnable(base.id, this.scheduler)));
    });
  }

  private * remoteMiningGenerator(): Generator<any, void, {kingdom: Kingdom, trace: Tracer}> {
    let bases: BaseConfig[] = []
    while (true) {
      const details: {kingdom: Kingdom, trace: Tracer} = yield;
      const kingdom = details.kingdom;
      const trace = details.trace;

      trace.log('remote mining', {bases});

      if (!bases.length) {
        trace.log('updating bases')
        bases = this.getBaseConfigs()
      }

      const base = bases.shift();
      trace.log('getting next base', {base});
      if (base) {
        this.remoteMining(kingdom, base, trace);
      }
    }
  }

  // TODO move this to base runnable
  private remoteMining(kingdom: Kingdom, baseConfig: BaseConfig, trace: Tracer) {
    trace.log('remote mining', {baseConfig});

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

    trace.log('current rooms', {current: baseConfig.rooms.length - 1, numDesired});

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

  private expandColonies(trace: Tracer, kingdom: Kingdom) {
    if (!this.config.autoExpand) {
      trace.warn('auto expand disabled');
      return;
    }

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
      const parking = new RoomPosition(origin.x + 5, origin.y + 5, origin.roomName);
      trace.notice('selected room, adding colony', {roomName, distance, origin, parking});
      this.addBase(roomName, false, origin, parking, true, [roomName], [], trace);
      return;
    }

    trace.log('no expansion selected');
  }

  private * baseWallsGenerator(): Generator<any, void, {kingdom: Kingdom, trace: Tracer}> {
    let bases: BaseConfig[] = []
    while (true) {
      const details: {kingdom: Kingdom, trace: Tracer} = yield;
      const kingdom = details.kingdom;
      const trace = details.trace;

      const needWalls = _.find(this.getBaseConfigs(), (baseConfig) => {
        return baseConfig.automated && !baseConfig.walls.length;
      });
      if (needWalls) {
        trace.log('need walls', {baseConfig: needWalls});
        this.updateBaseWalls(kingdom, needWalls, trace);
      }
    }
  }

  private updateBaseWalls(kingdom: Kingdom, base: BaseConfig, trace: Tracer) {
    const baseBounds = {
      x1: base.origin.x - 9, y1: base.origin.y - 9,
      x2: base.origin.x + 9, y2: base.origin.y + 9,
    };

    const [walls] = getCutTiles(base.primary, [baseBounds], ENTIRE_ROOM_BOUNDS);
    base.walls = walls;

    trace.log('created walls', {baseConfig: base});
  }
}

