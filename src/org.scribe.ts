import {stringify} from 'node:querystring';
import {OrgBase} from './org.base';

const COST_MATRIX_TTL = 1500;
const COST_DEFENDER_NOT_BASE = 6;

type Journal = {
  rooms: Record<string, RoomEntry>;
  creeps: Record<string, Creep>;
  defenderCostMatrices: Record<string, CostMatrixEntry>;
};

type CostMatrixEntry = {
  id: Id<Room>;
  costs: CostMatrix;
  ttl: number;
};

type PortalEntry = {
  id: Id<StructurePortal>,
  pos: RoomPosition,
  destinationShard: string;
  destinationRoom: string;
};

type RoomEntry = {
  id: Id<Room>,
  lastUpdated: number;
  controller?: {
    owner: string;
    level: number;
    safeModeAvailable: number;
  };
  numSources: number;
  hasHostiles: boolean;
  numTowers: number;
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

export class Scribe extends OrgBase {
  journal: Journal;

  constructor(parent, trace) {
    super(parent, 'scribe', trace);

    this.journal = {
      rooms: {},
      defenderCostMatrices: {},
      creeps: {},
    }

    const setupTrace = this.trace.begin('constructor');
    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    // TODO add stats
    this.updateStats();

    processTrace.end();
  }
  removeStaleJournalEntries() {

  }
  updateStats() {

  }
  getOldestRoomInList(rooms: string[]) {
    const knownRooms = Object.keys(this.journal.rooms);
    const missingRooms = _.shuffle(_.difference(rooms, knownRooms));

    if (missingRooms.length) {
      return missingRooms[0];
    }

    const inRangeRooms: RoomEntry[] = Object.values(_.pick(this.journal.rooms, rooms));
    const sortedRooms = _.sortBy(inRangeRooms, 'lastUpdated');

    return sortedRooms[0].id;
  }
  getRoomsUpdatedRecently() {
    return Object.values(this.journal.rooms).filter((room) => {
      return Game.time - room.lastUpdated < 500;
    }).map((room) => {
      return room.id;
    });
  }
  getRoomsWithPowerBanks() {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.powerBanks) {
        return false;
      }

      return room.powerBanks.length > 0;
    }).map((room) => {
      return [room.id, Game.time - room.lastUpdated, room.powerBanks[0].ttl];
    });
  }
  getRoomsWithHostileTowers() {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.controller || room.controller.owner === 'ENETDOWN') {
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
  getRoomsWithPortals() {
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
  getWeakRooms() {
    return Object.values(this.journal.rooms).filter((room) => {
      if (!room.controller || room.controller.owner === 'ENETDOWN') {
        return false;
      }

      if (room.controller.level >= 7) {
        return false;
      }

      if (room.controller.level < 1) {
        return false;
      }

      return true;
    }).map((room) => {
      return [room.id, room.numTowers, room.controller.owner];
    });
  }
  updateRoom(roomObject: Room) {
    const room: RoomEntry = {
      id: roomObject.name as Id<Room>,
      lastUpdated: Game.time,
      controller: null,
      numSources: 0,
      hasHostiles: false,
      numTowers: 0,
      mineral: null,
      powerBanks: [],
      portals: [],
      deposits: [],
    };

    if (roomObject.controller) {
      let owner = null;
      if (roomObject.controller.owner) {
        owner = roomObject.controller.owner.username;
      }

      room.controller = {
        owner: owner,
        level: roomObject.controller.level,
        safeModeAvailable: roomObject.controller.safeModeAvailable,
      };
    }

    room.numSources = roomObject.find(FIND_SOURCES).length;
    room.hasHostiles = roomObject.find(FIND_HOSTILE_CREEPS).length > 0;

    room.numTowers = roomObject.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER;
      },
    }).length;

    room.mineral = null;
    const minerals = roomObject.find(FIND_MINERALS);
    if (minerals.length) {
      room.mineral = minerals[0].mineralType;
    }

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

    room.deposits = roomObject.find(FIND_DEPOSITS).map((deposit) => {
      return {
        type: deposit.depositType,
        cooldown: deposit.cooldown,
        ttl: deposit.ticksToDecay,
      };
    });

    this.journal.rooms[room.id] = room;
  }
  getRoomById(roomId): RoomEntry {
    return this.journal.rooms[roomId] || null;
  }

  getLocalShardMemory(): any {
    return JSON.parse(InterShardMemory.getLocal() || '{}');
  }

  setLocalShardMemory(memory: any) {
    return InterShardMemory.setLocal(JSON.stringify(memory));
  }

  getRemoteShardMemory(shardName: string) {
    return JSON.parse(InterShardMemory.getRemote(shardName) || '{}');
  }

  getPortals(shardName: string) {
    const portals = Object.values(this.journal.rooms).filter((room) => {
      return _.filter(room.portals, _.matchesProperty('destinationShard', shardName)).length > 0;
    }).map((room) => {
      return room.portals.reduce((acc: PortalEntry[], portal) => {
        if (portal.destinationShard === shardName) {
          acc.push(portal);
        }

        return acc;
      }, []);
    }, []);

    return portals;
  }

  setCreepBackup(creep: Creep) {
    const localMemory = this.getLocalShardMemory();
    if (!localMemory.creep_backups) {
      localMemory.creep_backups = {};
    }

    localMemory.creep_backups[creep.name] = {
      name: creep.name,
      memory: creep.memory,
      ttl: Game.time,
    };

    localMemory.creep_backups = _.pick(localMemory.creep_backups, (backup) => {
      return Game.time - backup.ttl < 1500;
    });

    this.setLocalShardMemory(localMemory);
  }

  getCreepBackup(shardName: string, creepName: string) {
    const remoteMemory = this.getRemoteShardMemory(shardName);
    if (remoteMemory.creep_backups) {
      return remoteMemory.creep_backups[creepName] || null;
    }

    return null;
  }

  createDefenderCostMatric(room: Room, spawn: RoomPosition): CostMatrix {
    const costs = new PathFinder.CostMatrix();

    return costs;
  }

  getDefenderCostMatrix(room: Room, spawn: RoomPosition): CostMatrix {
    const costMatrixEntry = this.journal.defenderCostMatrices[room.name];
    if (costMatrixEntry && costMatrixEntry.ttl <= Game.time) {
      return
    }

    const costs = this.createDefenderCostMatric(room, spawn);

    this.journal.defenderCostMatrices[room.name] = {
      id: room.name as Id<Room>,
      costs,
      ttl: Game.time + COST_MATRIX_TTL,
    };

    return costs;
  }
}
