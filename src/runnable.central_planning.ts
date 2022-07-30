import {AlertLevel, Base} from './base';
import {ShardConfig} from './config';
import {Kernel, KernelThreadFunc, threadKernel} from './kernel';
import {pickExpansion} from './lib.expand';
import {ENTIRE_ROOM_BOUNDS, getCutTiles} from './lib.min_cut';
import {Tracer} from './lib.tracing';
import {Process, sleeping} from './os.process';
import {RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from './os.scheduler';
import BaseRunnable from './runnable.base';

const RUN_TTL = 10;
const BASE_PROCESSES_TTL = 50;
const EXPAND_TTL = 500;
const BASE_WALLS_TTL = 50;
const NEIGHBORS_THREAD_INTERVAL = 50;

export class CentralPlanning {
  private config: ShardConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private bases: Map<string, Base>;

  private threadBaseProcesses: KernelThreadFunc;
  private expandBasesThread: KernelThreadFunc;

  private baseWallsIterator: Generator<any, void, {kernel: Kernel, trace: Tracer}>;
  private baseWallsThread: KernelThreadFunc;

  private neighborsIterator: Generator<any, void, {kernel: Kernel, trace: Tracer}>;
  private neighborsThread: KernelThreadFunc;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.bases = new Map();

    this.shards.push(Game.shard.name);

    let bases: Map<string, Base> = new Map();
    if ((Memory as any).bases) {
      try {
        trace.warn('found shard memory', {bases: (Memory as any).bases.length});
        bases = new Map((Memory as any).bases);
      } catch (e) {
        trace.error('failed to load bases', {e});
        delete (Memory as any).bases
      }
    } else {
      trace.warn('no shard config found, bootstraping?');
    }

    // Setup known bases
    Array.from(bases.values()).forEach((base) => {
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
      trace.info('checking spawn', {roomName, origin});
      const parking = new RoomPosition(origin.x + 5, origin.y, origin.roomName);
      if (!this.bases.has(roomName)) {
        trace.warn('found unknown base', {roomName});
        this.addBase(roomName, false, origin, parking, [roomName], [],
          [], [], AlertLevel.GREEN, trace);
      }
    });

    trace.notice('bases configs', {bases: this.bases});

    this.threadBaseProcesses = threadKernel('base_processes', BASE_PROCESSES_TTL)(this.baseProcesses.bind(this));

    // TODO make this an iterator
    this.expandBasesThread = threadKernel('expand', EXPAND_TTL)(this.expandBases.bind(this));

    // Calculate base walls
    // TODO move this to the base
    this.baseWallsIterator = this.baseWallsGenerator();
    this.baseWallsThread = threadKernel('base_walls', BASE_WALLS_TTL)((trace: Tracer, kernel: Kernel) => {
      this.baseWallsIterator.next({kernel, trace});
    });

    this.neighborsIterator = this.neighborhoodsGenerator();
    this.neighborsThread = threadKernel('neighbors', NEIGHBORS_THREAD_INTERVAL)((trace: Tracer, kernel: Kernel) => {
      this.neighborsIterator.next({kernel, trace});
    });
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    this.threadBaseProcesses(trace, kernel);
    this.expandBasesThread(trace, kernel);
    this.baseWallsThread(trace, kernel);
    this.neighborsThread(trace, kernel);

    (Memory as any).bases = Array.from(this.bases.entries());

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getBase(baseId: string): Base {
    return this.bases.get(baseId);
  }

  getBases(): Base[] {
    return Array.from(this.bases.values());
  }

  getBaseMap(): Map<string, Base> {
    return this.bases;
  }

  getBaseById(baseId: string): Base {
    return this.bases.get(baseId);
  }

  getBaseByRoom(roomName: string): Base {
    for (const base of this.bases.values()) {
      if (base.rooms.includes(roomName)) {
        return base;
      }
    }

    return null;
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

  getClosestBaseInRange(roomName: string, range = 5): Base {
    let selectedBase = null;
    let selectedBaseDistance = 99999;

    Object.values(this.getBases()).forEach((base) => {
      const distance = Game.map.getRoomLinearDistance(base.primary, roomName);
      if (distance <= range && selectedBaseDistance > distance) {
        selectedBase = base;
        selectedBaseDistance = distance;
      }
    });

    return selectedBase;
  }

  addBase(primaryRoom: string, isPublic: boolean, origin: RoomPosition, parking: RoomPosition,
    rooms: string[], walls: {x: number, y: number}[],
    passages: {x: number, y: number}[], neighbors: string[], alertLevel: AlertLevel,
    trace: Tracer): Base {
    if (this.bases.has(primaryRoom)) {
      trace.error('base already exists', {primaryRoom});
      return;
    }

    if (rooms.indexOf(primaryRoom) === -1) {
      trace.warn('primary room not in rooms', {primaryRoom, rooms});
      rooms.unshift(primaryRoom);
    }

    this.bases.set(primaryRoom, {
      id: primaryRoom,
      isPublic: isPublic,
      primary: primaryRoom,
      rooms: rooms,
      origin: origin,
      parking: parking,
      walls: walls,
      passages: passages,
      neighbors: neighbors,
      alertLevel: alertLevel,
      boostPosition: null,
      boosts: new Map(),

      // @REFACTOR check these defaults
      storedEffects: new Map(),
      labsByAction: new Map(),
      terminalTask: null,
      defenseHitsLimit: 0,
      damagedStructures: [],
      damagedSecondaryStructures: [],
    });

    return this.bases.get(primaryRoom);
  }

  removeBase(baseId: string, trace: Tracer) {
    const base = this.getBase(baseId);
    if (!base) {
      trace.error('base does not exist', {baseId});
      return;
    }

    this.bases.delete(baseId);
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

  private expandBases(trace: Tracer, kernel: Kernel) {
    if (!this.config.autoExpand) {
      trace.warn('auto expand disabled');
      return;
    }

    /*
    const scribe = kernel.getScribe();
    const globalColonyCount = scribe.getGlobalColonyCount();
    if (!globalColonyCount) {
      trace.info('do not know global colony count yet');
      return;
    }

    const allowedColonies = Game.gcl.level;
    if (globalColonyCount >= allowedColonies) {
      trace.info('max GCL colonies reached', {globalColonyCount, allowedColonies});
      return;
    }
    */

    const bases = this.getBases();
    const numColonies = bases.length;
    const shardColonyMax = (this.config.maxColonies || 9999);
    if (numColonies >= shardColonyMax) {
      trace.info('max config colonies reached', {numColonies, shardColonyMax});
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

    trace.info('no expansion selected');
  }

  private * baseWallsGenerator(): Generator<any, void, {kernel: Kernel, trace: Tracer}> {
    const bases: Base[] = [];
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
    let bases: Base[] = [];
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
        return false;
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
    base.neighbors = nearbyBases.map((base) => base.id);

    trace.info('updated neighbors', {base: base});
  }
}

