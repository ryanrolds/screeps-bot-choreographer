import {Kernel} from './kernel';
import {Event} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {sleeping} from './os.process';
import {Runnable, RunnableResult} from './os.runnable';
import {thread, ThreadFunc} from './os.thread';
import {scoreAttacking, scoreHealing} from './role.harasser';
import {getDashboardStream, HudEventSet, HudIndicator, HudIndicatorStatus} from './runnable.debug_hud';

const RUN_TTL = 10;
const JOURNAL_ENTRY_TTL = 200;
const MAX_JOURNAL_TTL = 1000;
const WRITE_MEMORY_INTERVAL = 50;
const REMOVE_STALE_ENTRIES_INTERVAL = 100;
const UPDATE_COLONY_COUNT = 50;
const PRODUCE_EVENTS_INTERVAL = 50;

const YELLOW_JOURNAL_AGE = 100;
const RED_JOURNAL_AGE = 250;

type Journal = {
  rooms: Map<Id<Room>, RoomEntry>;
  creeps: Map<Id<Creep>, Creep>;
};

type PortalEntry = {
  id: Id<StructurePortal>,
  pos: RoomPosition,
  destinationShard: string;
  destinationRoom: string;
};

export type RoomEntry = {
  id: Id<Room>,
  lastUpdated: number;
  controller?: {
    owner: string;
    level: number;
    safeMode: number;
    safeModeAvailable: number;
    pos: RoomPosition;
  };
  specialRoom: boolean;
  status: string;
  hasSpawns: boolean;
  spawnLocation: RoomPosition;
  numSources: number;
  hasHostiles: boolean;
  hostilesDmg: number;
  hostilesHealing: number;
  hasKeepers: boolean;
  invaderCorePos: RoomPosition;
  invaderCoreLevel: number;
  invaderCoreTime: number;
  numTowers: number;
  numKeyStructures: number;
  myConstructionSites: number;
  mineral: MineralConstant;
  portals: PortalEntry[];
  powerBanks: {
    id: Id<StructurePowerBank>;
    hits: number;
    ttl: number;
    power: number;
    pos: RoomPosition;
  }[];
  deposits: {
    type: DepositConstant;
    cooldown: number;
    ttl: number;
  }[];
};

export type TargetRoom = {
  id: Id<Room>;
  numTowers: number;
  numKeyStructures: number;
  owner: string;
  level: number;
  controllerPos: RoomPosition;
};

export type ShardMemory = {
  time: number;
  status: RemoteStatus;
  creep_backups: Map<string, CreepBackup>;
  request_claimer: Map<string, CreepRequest>,
  request_builder: Map<string, CreepRequest>,
};

export type RemoteStatus = {
  numColonies: number;
};

export type CreepBackup = {
  name: string;
  memory: any;
  ttl: number;
};

export type CreepRequest = {
  shard: string;
  baseId: string;
  room: string;
  ttl: number;
}

export class Scribe implements Runnable {
  private journal: Journal;
  costMatrix255: CostMatrix;
  globalColonyCount: number;

  threadWriteMemory: ThreadFunc;
  threadRemoveStaleJournalEntries: ThreadFunc;
  threadUpdateBaseCount: ThreadFunc;
  threadProduceEvents: ThreadFunc;

  constructor() {
    this.journal = (Memory as any).scribe || {
      rooms: {},
      defenderCostMatrices: {},
      baseCostMatrices: {},
    };

    this.globalColonyCount = -2;

    this.threadRemoveStaleJournalEntries = thread('remove_stale', REMOVE_STALE_ENTRIES_INTERVAL)(this.removeStaleJournalEntries.bind(this));
    this.threadWriteMemory = thread('write_memory', WRITE_MEMORY_INTERVAL)(this.writeMemory.bind(this));
    this.threadUpdateBaseCount = thread('update_base_count', UPDATE_COLONY_COUNT)(this.updateBaseCount.bind(this));
    this.threadProduceEvents = thread('produce_events', PRODUCE_EVENTS_INTERVAL)(this.produceEvents.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('run');

    const updateRoomsTrace = trace.begin('update_rooms');
    // Iterate rooms and update if stale
    Object.values(Game.rooms).forEach((room) => {
      const entry = this.getRoomById(room.name);
      if (!entry || Game.time - entry.lastUpdated > JOURNAL_ENTRY_TTL) {
        this.updateRoom(kernel, room, updateRoomsTrace);
      }
    });
    updateRoomsTrace.end();

    this.threadRemoveStaleJournalEntries(trace);
    this.threadWriteMemory(trace);
    this.threadUpdateBaseCount(trace, kernel);
    this.threadProduceEvents(trace, kernel);

    /*
    const username = this.getKingdom().config.username;
    const friends = this.getKingdom().config.friends;
    const visual = Game.map.visual;
    this.getRooms().forEach((room) => {
      const age = Game.time - room.lastUpdated;
      const owner = room.controller?.owner || null;

      visual.text(age.toString(), new RoomPosition(49, 47, room.id), {
        align: 'right',
        fontSize: 4,
      });

      let roomPosture = '';
      if (owner && owner !== username) {
        roomPosture += '⚔️';
      }
      if (owner === username) {
        roomPosture += '🟢';
      }
      if (room.controller?.safeMode > 0) {
        roomPosture += '💢';
      }

      visual.text(roomPosture, new RoomPosition(0, 4, room.id), {
        align: 'left',
        fontSize: 6,
      });
    });
    */

    trace.end();

    return sleeping(RUN_TTL);
  }

  writeMemory(trace: Tracer) {
    trace.log('write_memory', {cpu: Game.cpu});

    if (Game.cpu.bucket < 1000) {
      trace.log('clearing journal from memory to reduce CPU load');
      (Memory as any).scribe = null;
      return;
    }

    (Memory as any).scribe = this.journal;
  }

  updateBaseCount(trace: Tracer, kerne: Kernel) {
    if (this.globalColonyCount === -2) {
      // skip the first time, we want to give shards time to update their remote memory
      trace.info('skipping updateColonyCount');
      this.globalColonyCount = -1;
      return;
    }

    const bases = kerne.getPlanner().getBases();
    let baseCount = bases.length;

    // Iterate shards and get their base counts
    this.getShardList().forEach((shard) => {
      if (shard === Game.shard.name) {
        return;
      }

      const shardMemory = this.getRemoteShardMemory(shard);
      baseCount += shardMemory?.status?.numColonies || 0;
    });

    trace.info('update_base_count', {baseCount: baseCount});

    this.globalColonyCount = baseCount;
  }

  produceEvents(trace: Tracer, kernel: Kernel) {
    const indicatorStream = kernel.getBroker().getStream(getDashboardStream());

    const rooms = this.getRooms();
    trace.info('produce_events', {rooms: rooms.length});
    rooms.forEach((roomEntry) => {
      const age = Game.time - roomEntry.lastUpdated;

      // Processes
      let processStatus = HudIndicatorStatus.Green;
      if (age > RED_JOURNAL_AGE) {
        processStatus = HudIndicatorStatus.Red;
      } else if (age > YELLOW_JOURNAL_AGE) {
        processStatus = HudIndicatorStatus.Yellow;
      }

      const spawnLengthIndicator: HudIndicator = {room: roomEntry.id, key: 'journal', display: '👁️', status: processStatus};
      indicatorStream.publish(new Event(`journal_${roomEntry.id}`, Game.time, HudEventSet, spawnLengthIndicator));
    });
  }

  getShardList(): string[] {
    const name = Game.shard.name;
    if (name.startsWith('shard') && name !== 'shardSeason') {
      return ['shard3', 'shard2', 'shard1', 'shard0'];
    }

    return [Game.shard.name];
  }

  getGlobalColonyCount() {
    if (this.globalColonyCount < 0) {
      return null;
    }

    return this.globalColonyCount;
  }

  removeStaleJournalEntries(trace) {
    const numBefore = Object.keys(this.journal.rooms).length;

    this.journal.rooms = _.pick(this.journal.rooms, (room) => {
      return Game.time - room.lastUpdated < MAX_JOURNAL_TTL;
    });

    trace.info('remove_stale', {numBefore, numAfter: Object.keys(this.journal.rooms).length});
  }

  getRoomById(roomId): RoomEntry {
    return this.journal.rooms.get(roomId) || null;
  }

  getRooms(): RoomEntry[] {
    return Object.values(this.journal.rooms);
  }

  getStats() {
    const rooms = Object.keys(this.journal.rooms) as Id<Room>[];
    const oldestId = this.getOldestRoomInList(rooms);
    const oldestRoom = this.getRoomById(oldestId);
    const oldestAge = oldestRoom ? Game.time - oldestRoom.lastUpdated : 0;

    return {
      rooms: rooms.length,
      oldestRoom: oldestId,
      oldestAge: oldestAge,
    };
  }

  getOldestRoomInList(rooms: Id<Room>[]): Id<Room> {
    const knownRooms = _.keys(this.journal.rooms) as Id<Room>[];
    const missingRooms = _.difference<Id<Room>>(rooms, knownRooms);
    if (missingRooms.length) {
      return _.shuffle(missingRooms)[0];
    }

    const inRangeRooms: RoomEntry[] = Object.values(_.pick(this.journal.rooms, rooms));
    const sortedRooms = _.sortBy(inRangeRooms, 'lastUpdated');
    if (!sortedRooms.length) {
      return null;
    }

    return sortedRooms[0].id;
  }

  getRoomsUpdatedRecently() {
    return Object.values(this.journal.rooms).filter((room) => {
      return Game.time - room.lastUpdated < 500;
    }).map((room) => {
      return room.id;
    });
  }

  getRoomsWithPowerBanks(): [Id<Room>, number, number][] {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.powerBanks) {
        return false;
      }

      return room.powerBanks.length > 0;
    }).map((room) => {
      return [room.id, Game.time - room.lastUpdated, room.powerBanks[0].ttl];
    });
  }

  getRoomsWithInvaderBases(): [Id<Room>, number][] {
    const found: [Id<Room>, number][] = [];
    for (const [key, room] of this.journal.rooms) {
      if (room.invaderCoreLevel > 0) {
        found.push([room.id, Game.time - room.lastUpdated]);
      }
    }
    return found;
  }

  getRoomsWithHostileTowers(kernel): [Id<Room>, number, string][] {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.controller || room.controller.owner === kernel.getPlanner().getUsername()) {
        return false;
      }

      if (!room.numTowers) {
        return false;
      }

      return true;
    }).map((room) => {
      return [room.id, room.numTowers, room.controller.owner];
    });
  }

  getRoomsWithPortals(): [Id<Room>, number, string[]][] {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.portals) {
        return false;
      }

      return room.portals.length > 0;
    }).map((room) => {
      return [room.id, Game.time - room.lastUpdated, room.portals.map((portal) => {
        return portal.destinationShard;
      })];
    });
  }

  getRoomsWithMyConstructionSites(): {id: Id<Room>, sites: number}[] {
    let rooms = Object.values(this.journal.rooms).filter((room) => {
      return room.myConstructionSites > 0;
    });

    rooms = _.sortByOrder(rooms, 'myConstructionSites', 'desc');

    return rooms.map((room) => {
      return {id: room.id, sites: room.myConstructionSites};
    });
  }

  getHostileRooms(kernel): TargetRoom[] {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.controller || room.controller.owner === kernel.getPlanner().getUsername()) {
        return false;
      }

      if (room.specialRoom) {
        return false;
      }

      if (room.controller.level < 1) {
        return false;
      }

      if (room.controller.safeMode) {
        return false;
      }

      return true;
    }).map((room) => {
      return {
        id: room.id,
        numTowers: room.numTowers,
        numKeyStructures: room.numKeyStructures,
        owner: room.controller.owner,
        level: room.controller.level,
        controllerPos: room.controller.pos,
      };
    });
  }

  updateRoom(kernel: Kernel, roomObject: Room, trace: Tracer) {
    trace = trace.begin('update_room');
    trace = trace.withFields(new Map([['room', roomObject.name]]));
    const end = trace.startTimer('update_room');

    const room: RoomEntry = {
      id: roomObject.name as Id<Room>,
      lastUpdated: Game.time,
      specialRoom: false,
      status: null,
      controller: null,
      hasSpawns: false,
      spawnLocation: null,
      numSources: 0,
      hasHostiles: false,
      hostilesDmg: 0,
      hostilesHealing: 0,
      hasKeepers: false,
      invaderCorePos: null,
      invaderCoreLevel: null,
      invaderCoreTime: null,
      numTowers: 0,
      numKeyStructures: 0,
      myConstructionSites: 0,
      mineral: null,
      powerBanks: [],
      portals: [],
      deposits: [],
    };

    const controllerEnd = trace.startTimer('controller');

    if (roomObject.controller) {
      let owner = null;
      if (roomObject.controller.owner) {
        owner = roomObject.controller.owner.username;
      }

      if (roomObject.controller?.reservation?.username) {
        owner = roomObject.controller.reservation.username;
      }

      room.controller = {
        owner: owner,
        level: roomObject.controller.level,
        safeMode: roomObject.controller.safeMode || 0,
        safeModeAvailable: roomObject.controller.safeModeAvailable,
        pos: roomObject.controller.pos,
      };

      const spawns = roomObject.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_SPAWN;
        },
      });
      room.hasSpawns = spawns.length > 0;
      room.spawnLocation = spawns[0]?.pos;
    }

    controllerEnd();

    const roomStatusEnd = trace.startTimer('roomStatus');

    let status = null;
    try {
      status = Game.map.getRoomStatus(roomObject.name);
    } catch (e) {
      trace.warn('problem getting room status from game, assuming normal', e);
    }

    room.status = status?.status || 'normal';
    room.specialRoom = room.status !== 'normal';

    roomStatusEnd();

    const sourcesEnd = trace.startTimer('sources');

    room.numSources = roomObject.find(FIND_SOURCES).length;

    sourcesEnd();

    const hostilesEnd = trace.startTimer('hostiles');

    const hostiles = roomObject.find(FIND_HOSTILE_CREEPS);
    // Filter friendly creeps
    const friends = kernel.getFriends();
    const hostileCreeps = hostiles.filter((creep) => {
      const owner = creep.owner.username;
      return friends.indexOf(owner) === -1 && owner !== 'Source Keeper';
    });
    room.hasHostiles = hostileCreeps.length > 0;

    if (room.hasHostiles) {
      room.hostilesDmg = _.sum(hostileCreeps, (creep) => {
        return scoreAttacking(creep);
      });

      room.hostilesHealing = _.sum(hostileCreeps, (creep) => {
        return scoreHealing(creep);
      });
    } else {
      room.hostilesDmg = 0;
      room.hostilesHealing = 0;
    }

    const keepers = hostiles.filter((creep) => {
      const owner = creep.owner.username;
      return owner === 'Source Keeper';
    });
    room.hasKeepers = keepers.length > 0;

    const invaderCores: StructureInvaderCore[] = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_INVADER_CORE && structure.isActive();
      },
    });
    if (invaderCores.length) {
      room.invaderCorePos = invaderCores[0].pos;
      room.invaderCoreLevel = invaderCores[0].level;
      room.invaderCoreTime = invaderCores[0].effects[EFFECT_COLLAPSE_TIMER]?.ticksRemaining;
    }

    hostilesEnd();

    const towersEnd = trace.startTimer('towers');

    room.numTowers = roomObject.find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER &&
          structure.owner?.username !== kernel.getPlanner().getUsername();
      },
    }).length;

    towersEnd();

    const keyStructuresEnd = trace.startTimer('keyStructures');

    room.numKeyStructures = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.isActive() && (structure.structureType === STRUCTURE_TOWER ||
          structure.structureType === STRUCTURE_SPAWN ||
          structure.structureType === STRUCTURE_TERMINAL ||
          structure.structureType === STRUCTURE_NUKER ||
          structure.structureType === STRUCTURE_INVADER_CORE);
      },
    }).length;

    keyStructuresEnd();

    const constructionSitesEnd = trace.startTimer('constructionSites');
    room.myConstructionSites = roomObject.find(FIND_MY_CONSTRUCTION_SITES).length;
    constructionSitesEnd();

    const mineralEnd = trace.startTimer('mineral');

    room.mineral = null;
    const minerals = roomObject.find(FIND_MINERALS);
    if (minerals.length) {
      room.mineral = minerals[0].mineralType;
    }

    mineralEnd();

    const portalsEnd = trace.startTimer('portals');

    room.portals = [];
    const portals = roomObject.find<StructurePortal>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_PORTAL;
      },
    });
    room.portals = portals.map((portal) => {
      return {
        id: portal.id,
        pos: portal.pos,
        destinationShard: (portal.destination as any).shard,
        destinationRoom: (portal.destination as any).room,
      };
    });

    portalsEnd();

    const powerBanksEnd = trace.startTimer('powerBanks');

    room.powerBanks = roomObject.find<StructurePowerBank>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_POWER_BANK;
      },
    }).map((powerBank) => {
      return {
        id: powerBank.id,
        hits: powerBank.hits,
        ttl: powerBank.ticksToDecay,
        power: powerBank.power,
        pos: powerBank.pos,
      };
    });

    powerBanksEnd();

    const depositsEnd = trace.startTimer('deposits');

    room.deposits = roomObject.find(FIND_DEPOSITS).map((deposit) => {
      return {
        type: deposit.depositType,
        cooldown: deposit.cooldown,
        ttl: deposit.ticksToDecay,
      };
    });

    depositsEnd();

    this.journal.rooms.set(room.id, room);

    const duration = end();
    trace.log('updated room', {duration, room: room.id});
    trace.end();
  }

  clearRoom(roomId: Id<Room>) {
    this.journal.rooms.delete(roomId);
  }

  getLocalShardMemory(): ShardMemory {
    if (typeof (InterShardMemory) === 'undefined') {
      return {} as ShardMemory;
    }

    return JSON.parse(InterShardMemory.getLocal() || '{}');
  }

  setLocalShardMemory(memory: ShardMemory) {
    if (typeof (InterShardMemory) === 'undefined') {
      return;
    }

    return InterShardMemory.setLocal(JSON.stringify(memory));
  }

  getRemoteShardMemory(shardName: string): ShardMemory {
    if (typeof (InterShardMemory) === 'undefined') {
      return {} as any;
    }

    return JSON.parse(InterShardMemory.getRemote(shardName) || '{}');
  }

  getPortals(shardName: string): PortalEntry[] {
    return Object.values(this.journal.rooms).reduce((portals, room) => {
      return portals.concat(_.filter(room.portals, _.matchesProperty('destinationShard', shardName)));
    }, [] as PortalEntry[]);
  }

  setCreepBackup(creep: Creep) {
    const localMemory = this.getLocalShardMemory();
    if (!localMemory.creep_backups) {
      localMemory.creep_backups = new Map();
    }

    localMemory.creep_backups.set(creep.name, {
      name: creep.name,
      memory: creep.memory,
      ttl: Game.time,
    });

    localMemory.creep_backups = _.pick(localMemory.creep_backups, (backup) => {
      return Game.time - backup.ttl < 1500;
    });

    this.setLocalShardMemory(localMemory);
  }

  getCreepBackup(shardName: string, creepName: string) {
    const remoteMemory = this.getRemoteShardMemory(shardName);
    if (remoteMemory.creep_backups) {
      return remoteMemory.creep_backups.get(creepName) || null;
    }

    return null;
  }
}

