import {AlertLevel, Base, BaseMap} from "./base";
import {ShardConfig} from "./config";
import {WORKER_EXPLORER} from "./constants.creeps";
import {MEMORY_ASSIGN_ROOM, MEMORY_BASE} from "./constants.memory";
import {EXPLORER} from "./constants.priorities";
import {Kernel} from "./kernel";
import {pickExpansion} from "./lib.expand";
import {ENTIRE_ROOM_BOUNDS, getCutTiles} from "./lib.min_cut";
import {desiredRemotes, findNextRemoteRoom} from "./lib.remote_room";
import {Tracer} from "./lib.tracing";
import {Process, sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import BaseRunnable from "./runnable.base";
import {createSpawnRequest, getBaseSpawnTopic} from "./runnable.base_spawning";

const RUN_TTL = 10;
const BASE_PROCESSES_TTL = 50;
const REMOTE_MINING_TTL = 100;
const EXPAND_TTL = 250;
const BASE_WALLS_TTL = 50;
const NEIGHBORS_THREAD_INTERVAL = 10;

export class CentralPlanning {
  private config: ShardConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private bases: Record<string, Base>;
  private roomByBaseId: Record<string, string>;

  private threadBaseProcesses: ThreadFunc;
  private remoteMiningIterator: Generator<any, void, {kernel: Kernel, trace: Tracer}>;
  private remoteMiningThread: ThreadFunc;
  private expandColoniesThread: ThreadFunc;

  private baseWallsIterator: Generator<any, void, {kernel: Kernel, trace: Tracer}>;
  private baseWallsThread: ThreadFunc;

  private neighborsIterator: Generator<any, void, {kernel: Kernel, trace: Tracer}>;
  private neighborsThread: ThreadFunc;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.bases = {};
    this.roomByBaseId = {};

    this.shards.push(Game.shard.name);

    let bases: BaseMap = {};
    if ((Memory as any).bases) {
      trace.warn('found shard memory', {bases: (Memory as any).bases});
      bases = (Memory as any).bases;
    } else {
      trace.warn('no shard config found, bootstraping?');
    }

    // Setup known bases
    Object.values(bases).forEach((base) => {
      trace.notice('setting up base', {base});

      const origin = new RoomPosition(base.origin.x, base.origin.y, base.origin.roomName);
      const parking = new RoomPosition(base.parking.x, base.parking.y, base.parking.roomName);

      this.addBase(base.id, base.isPublic, origin, parking,
        base.rooms, base.walls || [], base.passages || [], base.neighbors || [],
        base.alertLevel || AlertLevel.GREEN, trace);
    });

    // Check for spawns without bases
    Object.values(Game.spawns).forEach((spawn) => {
      const roomName = spawn.room.name;
      const origin = new RoomPosition(spawn.pos.x, spawn.pos.y + 4, spawn.pos.roomName);
      trace.log('checking spawn', {roomName, origin});
      const parking = new RoomPosition(origin.x + 5, origin.y, origin.roomName);
      if (!this.bases[roomName]) {
        trace.warn('found unknown base', {roomName});
        this.addBase(roomName, false, origin, parking, [roomName], [],
          [], [], AlertLevel.GREEN, trace);
      }
    });

    trace.notice('bases configs', {bases: this.bases});

    this.threadBaseProcesses = thread('base_processes', BASE_PROCESSES_TTL)(this.baseProcesses.bind(this));

    this.remoteMiningIterator = this.remoteMiningGenerator();
    this.remoteMiningThread = thread('remote_mining', REMOTE_MINING_TTL)((trace: Tracer, kernel: Kernel) => {
      this.remoteMiningIterator.next({kernel, trace});
    });

    // TODO make this an iterator
    this.expandColoniesThread = thread('expand', EXPAND_TTL)(this.expandColonies.bind(this));

    // Calculate base walls
    this.baseWallsIterator = this.baseWallsGenerator();
    this.baseWallsThread = thread('base_walls', BASE_WALLS_TTL)((trace: Tracer, kernel: Kernel) => {
      this.baseWallsIterator.next({kernel, trace});
    });

    this.neighborsIterator = this.neighborhoodsGenerator();
    this.neighborsThread = thread('neighbors', NEIGHBORS_THREAD_INTERVAL)((trace: Tracer, kernel: Kernel) => {
      this.neighborsIterator.next({kernel, trace});
    });
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    this.threadBaseProcesses(trace, kernel);
    this.remoteMiningThread(trace, kernel);
    this.expandColoniesThread(trace, kernel);
    this.baseWallsThread(trace, kernel);
    this.neighborsThread(trace, kernel);

    (Memory as any).bases = this.bases;

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getBase(colonyId: string): Base {
    return this.bases[colonyId];
  }

  getBases(): Base[] {
    return _.values(this.bases);
  }

  getBaseList(): Base[] {
    return _.values(this.bases);
  }

  getBaseMap(): Record<string, Base> {
    return this.bases;
  }

  getBaseById(colonyId: string): Base {
    return this.bases[colonyId];
  }

  getBaseByRoom(roomName: string): Base {
    const baseId = this.roomByBaseId[roomName];
    if (!baseId) {
      return null;
    }

    return this.getBase(baseId);
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

  getClosestBaseInRange(roomName: string, range: Number = 5): Base {
    let selectedBase = null;
    let selectedBaseDistance = 99999;

    Object.values(this.getBases()).forEach((base) => {
      const distance = Game.map.getRoomLinearDistance(base.primary, roomName)
      if (distance <= range && selectedBaseDistance > distance) {
        selectedBase = base;
        selectedBaseDistance = distance;
      }
    })

    return selectedBase;
  }

  addBase(primaryRoom: string, isPublic: boolean, origin: RoomPosition, parking: RoomPosition,
    rooms: string[], walls: {x: number, y: number}[],
    passages: {x: number, y: number}[], neighbors: string[], alertLevel: AlertLevel,
    trace: Tracer): Base {
    if (this.bases[primaryRoom]) {
      trace.error('colony already exists', {primaryRoom});
      return;
    }

    this.bases[primaryRoom] = {
      id: primaryRoom,
      isPublic: isPublic,
      primary: primaryRoom,
      rooms: [],
      origin: origin,
      parking: parking,
      walls: walls,
      passages: passages,
      neighbors: neighbors,
      alertLevel: alertLevel,
      boostPosition: null,
      boosts: {},
    };

    this.roomByBaseId[primaryRoom] = primaryRoom;

    // Add any additional rooms, primary is expected to be first
    rooms.forEach((roomName) => {
      this.addRoom(primaryRoom, roomName, trace)
    });

    return this.bases[primaryRoom];
  }

  removeBase(colonyId: string, trace: Tracer) {
    const base = this.getBase(colonyId);
    const rooms = base.rooms;
    rooms.forEach((roomName) => {
      this.removeRoom(roomName, trace);
    });

    delete this.bases[colonyId];
  }

  addRoom(colonyId: string, roomName: string, trace: Tracer) {
    trace.notice('adding room', {colonyId, roomName});

    const base = this.getBase(colonyId);
    if (!base) {
      trace.error('no colony found', {roomName});
      return;
    }
    this.roomByBaseId[roomName] = colonyId;

    if (base.rooms.indexOf(roomName) !== -1) {
      trace.error('room already exists', {roomName});
      return;
    }
    base.rooms.push(roomName);
  }

  removeRoom(roomName: string, trace: Tracer) {
    trace.notice('removing room', {roomName});

    const base = this.getBaseByRoom(roomName);
    if (!base) {
      trace.error('no colony found', {roomName});
      return;
    }

    base.rooms = _.without(base.rooms, roomName);
    delete this.roomByBaseId[roomName];

    // remove constructions sites for room
    const sites = _.values<ConstructionSite>(Game.constructionSites);
    sites.forEach((site) => {
      if (!site.room) {
        trace.info('checking site', {site});
      }

      if (site.room?.name === roomName) {
        site.remove();
      }
    });

    trace.log('room removed from colony', {colonyId: base.id, roomName});
  }

  private baseProcesses(trace: Tracer, kernel: Kernel) {
    // If any defined colonies don't exist, run it
    const bases = kernel.getPlanner().getBases();
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

  private * remoteMiningGenerator(): Generator<any, void, {kernel: Kernel, trace: Tracer}> {
    let bases: Base[] = []
    while (true) {
      const details: {kernel: Kernel, trace: Tracer} = yield;
      const kernel = details.kernel;
      const trace = details.trace;

      trace.log('remote mining', {bases});

      if (!bases.length) {
        trace.log('updating bases')
        bases = this.getBases()
      }

      const base = bases.shift();
      trace.log('getting next base', {base});
      if (base) {
        this.remoteMining(kernel, base, trace);
      }
    }
  }

  // TODO move this to base runnable
  private remoteMining(kernel: Kernel, base: Base, trace: Tracer) {
    trace.log('remote mining', {base});

    const primaryRoom = Game.rooms[base.primary];
    if (!primaryRoom) {
      trace.warn('primary room not found', {base});
      return null;
    }

    const level = primaryRoom?.controller?.level || 0;
    let numDesired = desiredRemotes(base, level);

    trace.log('current rooms', {current: base.rooms.length - 1, numDesired});

    base.rooms.forEach((roomName) => {
      const roomEntry = kernel.getScribe().getRoomById(roomName);
      if (!roomEntry) {
        trace.warn('room not found', {roomName});
        return;
      }

      // If room is controlled by someone else, don't claim it
      if (roomEntry?.controller?.owner !== kernel.getPlanner().getUsername() &&
        roomEntry?.controller?.level > 0) {
        trace.warn('room owned, removing remove', {roomName});
        this.removeRoom(roomName, trace);
      }
    });

    while (base.rooms.length - 1 > numDesired) {
      trace.notice('more rooms than desired, removing room', {base});
      this.removeRoom(base.rooms[base.rooms.length - 1], trace);
    }

    if (base.rooms.length - 1 < numDesired) {
      // Check if adjacent rooms to the base have been explored
      const exits = _.values(Game.map.describeExits(base.primary));
      const unexploredClaimable = exits.filter((room) => {
        // TODO dont wait on always or center rooms
        const roomEntry = kernel.getScribe().getRoomById(room);
        if (!roomEntry) {
          return true;
        }

        return false;
      });

      // If adjacent rooms are unexplored, explore them
      if (unexploredClaimable.length) {
        trace.warn('room not explored, do not expand', {unexploredClaimable});

        unexploredClaimable.forEach((roomName) => {
          // request explorers
          const priorities = EXPLORER;
          const ttl = REMOTE_MINING_TTL;
          const role = WORKER_EXPLORER;
          const memory = {
            [MEMORY_BASE]: base.id,
            [MEMORY_ASSIGN_ROOM]: roomName,
          };

          const request = createSpawnRequest(priorities, ttl, role, memory, 0);
          trace.notice('requesting explorer for adjacent room', {request});
          kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
        });
        return;
      }

      // Pick next room to claim
      const [nextRemote, debug] = findNextRemoteRoom(kernel, base, trace);
      if (!nextRemote) {
        trace.warn('no remote room found', {colonyId: base.id});
        return;
      }

      // Add room to the base
      trace.notice('adding remote', {room: nextRemote, base});
      this.addRoom(base.id, nextRemote, trace);
    }
  }

  private expandColonies(trace: Tracer, kernel: Kernel) {
    if (!this.config.autoExpand) {
      trace.warn('auto expand disabled');
      return;
    }

    const scribe = kernel.getScribe();
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

    const bases = this.getBases();
    const numColonies = bases.length;
    const shardColonyMax = (this.config.maxColonies || 9999);
    if (numColonies >= shardColonyMax) {
      trace.log('max config colonies reached', {numColonies, shardColonyMax});
      return;
    }

    const results = pickExpansion(kernel, trace);
    if (results.selected) {
      const roomName = results.selected;
      const distance = results.distance;
      const origin = results.origin;
      const parking = new RoomPosition(origin.x + 5, origin.y + 5, origin.roomName);
      trace.notice('selected room, adding colony', {roomName, distance, origin, parking});
      const base = this.addBase(roomName, false, origin, parking, [roomName],
        [], [], [], AlertLevel.GREEN, trace);
      this.updateNeighbors(kernel, base, trace);
      return;
    }

    trace.log('no expansion selected');
  }

  private * baseWallsGenerator(): Generator<any, void, {kernel: Kernel, trace: Tracer}> {
    let bases: Base[] = []
    while (true) {
      const details: {kernel: Kernel, trace: Tracer} = yield;
      const kernel = details.kernel;
      const trace = details.trace;

      const needWalls = _.find(this.getBases(), (base) => {
        return !base.walls.length;
      });
      if (needWalls) {
        trace.info('need walls', {base: needWalls});
        this.updateBaseWalls(kernel, needWalls, trace);
      }
    }
  }

  private updateBaseWalls(kernel: Kernel, base: Base, trace: Tracer) {
    const baseBounds = {
      x1: base.origin.x - 9, y1: base.origin.y - 9,
      x2: base.origin.x + 9, y2: base.origin.y + 9,
    };

    const [walls] = getCutTiles(base.primary, [baseBounds], ENTIRE_ROOM_BOUNDS);
    base.walls = walls;

    trace.info('created walls', {base: base});
  }

  private * neighborhoodsGenerator(): Generator<any, void, {kernel: Kernel, trace: Tracer}> {
    let bases: Base[] = []
    while (true) {
      const details: {kernel: Kernel, trace: Tracer} = yield;
      const kernel = details.kernel;
      const trace = details.trace;

      if (!bases.length) {
        bases = this.getBases();
      }

      const base = bases.shift();
      trace.info('getting next base', {base});
      if (base) {
        this.updateNeighbors(kernel, base, trace);
      }
    }
  }

  private updateNeighbors(kernel: Kernel, base: Base, trace: Tracer) {
    // Narrow bases to ones that are nearby
    let nearbyBases = _.filter(this.getBases(), (base) => {
      if (base.id === base.id) {
        return false
      }

      const distance = Game.map.getRoomLinearDistance(base.primary, base.primary);
      if (distance > 5) {
        return false;
      }

      // RAKE calculate path check number of rooms in path, factoring in enemy rooms

      return true;
    });

    // Sort by distance
    nearbyBases = _.sortBy(nearbyBases, (base) => {
      return Game.map.getRoomLinearDistance(base.primary, base.primary);
    });

    // Pick at most nearest 3
    nearbyBases = _.take(nearbyBases, 3);

    // Set bases neighbors
    base.neighbors = nearbyBases.map(base => base.id);

    trace.info('updated neighbors', {base: base});
  }
}

