import BaseRunnable from '../base/runnable';
import {BASE_SECTOR_RADIUS, getNearbyRooms} from '../base/scouting';
import {ShardConfig} from '../config';
import {pickExpansion} from '../lib/expand';
import {Metrics} from '../lib/metrics';
import {Tracer} from '../lib/tracing';
import {AlertLevel, Base, getBasePrimaryRoom} from '../os/kernel/base';
import {Kernel, KernelThreadFunc, threadKernel} from '../os/kernel/kernel';
import {Process, RunnableResult, sleeping} from '../os/process';
import {Priorities, Scheduler} from '../os/scheduler';
import {YELLOW_JOURNAL_AGE} from './scribe';

const RUN_TTL = 10;
const BASE_PROCESSES_TTL = 50;
const EXPAND_TTL = 500;

export class BaseManager {
  private config: ShardConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private bases: Map<string, Base>;

  private threadBaseProcesses: KernelThreadFunc;
  private expandBasesThread: KernelThreadFunc;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.bases = new Map();

    this.shards.push(Game.shard.name);

    let bases: Map<string, Base> = new Map();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((Memory as any).bases) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trace.warn('found shard memory', {bases: (Memory as any).bases.length});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bases = new Map((Memory as any).bases);
      } catch (e) {
        trace.error('failed to load bases', {e});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    this.threadBaseProcesses(trace, kernel);
    this.expandBasesThread(trace, kernel);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const scribe = kernel.getScribe();
    const globalBaseCount = scribe.getGlobalBaseCount();
    if (!globalBaseCount) {
      trace.info('do not know global base count yet');
      return;
    }

    const allowedColonies = Game.gcl.level;
    if (globalBaseCount >= allowedColonies) {
      trace.info('max GCL colonies reached', {globalBaseCount, allowedColonies});
      return;
    }


    const bases = this.getBases();
    const numColonies = bases.length;
    const shardBaseMax = (this.config.maxColonies || 9999);
    if (numColonies >= shardBaseMax) {
      trace.info('max config colonies reached', {numColonies, shardBaseMax});
      return;
    }

    const results = pickExpansion(kernel, trace);
    if (results.selected) {
      const roomName = results.selected;
      const distance = results.distance;
      const origin = results.origin;
      const parking = new RoomPosition(origin.x + 5, origin.y + 5, origin.roomName);
      trace.notice('selected room, adding base', {roomName, distance, origin, parking});
      this.addBase(roomName, false, origin, parking, [roomName],
        [], [], [], AlertLevel.GREEN, trace);
      return;
    }

    trace.info('no expansion selected');
  }

  reportMetrics(kernel: Kernel, metrics: Metrics, trace: Tracer): void {
    this.getBases().forEach((base) => {
      const primaryRoom = getBasePrimaryRoom(base);
      if (!primaryRoom) {
        trace.warn('no primary room for base', {base});
        return;
      }

      const roomLevel = primaryRoom.controller?.level || 0;
      metrics.gauge("base_level", roomLevel, {base: base.id});

      const roomProgress = primaryRoom.controller?.progress || 0;
      const roomProgressTotal = primaryRoom.controller?.progressTotal || 0;
      let roomProgressPercent = 0;
      if (roomProgressTotal > 0 && roomProgress > 0) {
        roomProgressPercent = roomProgress / roomProgressTotal;
      }
      metrics.gauge("base_level_progress", roomProgressPercent, {base: base.id});

      const energyAvailable = primaryRoom.energyAvailable;
      metrics.gauge("base_energy_available", energyAvailable, {base: base.id});
      const storedEnergy = primaryRoom.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
      metrics.gauge("base_energy_stored", storedEnergy, {base: base.id});

      metrics.gauge("base_rooms_total", base.rooms.length, {base: base.id});

      let missingRoomEntries = 0;

      // Report room level metrics
      base.rooms.forEach((roomName) => {
        // Remote Room Entry age
        const roomEntry = kernel.getScribe().getRoomById(roomName);
        if (roomEntry) {
          metrics.gauge('scribe_room_entry_age', Game.time - roomEntry.lastUpdated,
            {room: roomName, base: base.id});
          metrics.gauge('scribe_room_entry_hostile_attack_total', roomEntry.hostilesDmg,
            {room: roomName, base: base.id});
          metrics.gauge('scribe_room_entry_hostile_healing_total', roomEntry.hostilesHealing,
            {room: roomName, base: base.id});
        } else {
          missingRoomEntries++
        }
      });

      metrics.gauge('scribe_room_entry_missing', missingRoomEntries, {base: base.id});

      // get nearby rooms and report if fresh room entries
      const nearbyRoomNames = getNearbyRooms(base.primary, BASE_SECTOR_RADIUS);
      const freshNearbyRoomEntries = nearbyRoomNames.filter((roomName) => {
        // if no room entry, not fresh
        const roomEntry = kernel.getScribe().getRoomById(roomName);
        if (!roomEntry) {
          return false;
        }

        // If last updated is older then "yellow" threshold, not fresh
        if (roomEntry.lastUpdated < Game.time - YELLOW_JOURNAL_AGE) {
          return false;
        }

        return true;
      });
      metrics.gauge('base_fresh_sector_room_entries', freshNearbyRoomEntries.length, {base: base.id});
    });
  }
}

