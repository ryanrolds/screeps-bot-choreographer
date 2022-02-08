import {OrgParent} from './org';
import {Colony} from './org.colony';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import {creepIsFresh} from './behavior.commute';
import {thread, ThreadFunc} from './os.thread';
import {Tracer} from './lib.tracing'
import {Kingdom} from './org.kingdom';
import {BoosterDetails, EffectSet, LabsByResource, TOPIC_ROOM_BOOSTS} from './runnable.base_booster';
import {getBaseSpawnTopic} from './topics.base';
import {BaseConfig} from './config';

export const TOPIC_ROOM_KEYVALUE = 'room_keyvalue';

const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const PER_LEVEL_ENERGY = 100000;
const UPGRADER_BUFFER = 25000;

// TODO increase this later, we should be able to sustain at least one nuke
// before the walls break
const MAX_WALL_HITS = 11000000;

const UPDATE_CREEPS_TTL = 1;
const UPDATE_ROOM_TTL = 10;
const UPDATE_RESOURCES_TTL = 5;
const UPDATE_BOOSTER_TTL = 5;
const UPDATE_DAMAGED_CREEPS_TTL = 5;
const UPDATE_DAMAGED_STRUCTURES_TTL = 40;
const UPDATE_DAMAGED_SECONDARY_TTL = 15;

export enum AlertLevel {
  GREEN = "green",
  YELLOW = "yellow",
  RED = "red",
};

export type ResourceCounts = Partial<Record<ResourceConstant, number>>;

export default class OrgRoom extends OrgParent {
  roomName: string;
  room: Room;
  isPrimary: boolean;
  isPublic: boolean;
  assignedCreeps: Creep[];
  defenderIds: Id<Creep>[];
  unowned: boolean;
  claimedByMe: boolean;
  reservedByMe: boolean;
  myStructures: Structure[];
  roomStructures: Structure[];
  hostileStructures: Structure[];
  resources: ResourceCounts;
  hasStorage: boolean;

  damagedCreeps: string[];
  damagedStructures: Id<AnyStructure>[];
  defenseHitsLimit: number;
  damagedSecondaryStructures: Id<AnyStructure>[];

  stationFlags: Flag[];

  threadUpdateCreeps: ThreadFunc;
  threadUpdateRoom: ThreadFunc;
  threadUpdateResources: ThreadFunc;
  threadUpdateDamagedCreeps: ThreadFunc;
  threadUpdateBoosters: ThreadFunc;
  updateDamagedCreeps: ThreadFunc;
  updateDamagedStructure: ThreadFunc;
  updateDamagedSecondaryStructures: ThreadFunc;

  boosterAllEffects: EffectSet;
  boosterEffects: EffectSet;
  boosterPosition: RoomPosition;
  boosterLabs: LabsByResource;

  constructor(parent: Colony, roomName: string, room: Room, trace: Tracer) {
    super(parent, roomName, trace);

    const setupTrace = this.trace.begin('constructor');

    this.roomName = roomName;
    this.room = room;
    this.isPrimary = roomName === parent.primaryRoomId;
    this.isPublic = parent.isPublic;

    // Creeps
    this.assignedCreeps = [];
    this.defenderIds = [];
    this.threadUpdateCreeps = thread('update_creeps_thread', UPDATE_CREEPS_TTL)((trace, kingdom) => {
      this.updateCreeps(kingdom, trace);
    });

    // Common room
    this.unowned = true;
    this.claimedByMe = false;
    this.reservedByMe = false;
    this.myStructures = [];
    this.roomStructures = [];
    this.hostileStructures = [];

    this.threadUpdateRoom = thread('update_room_thread', UPDATE_ROOM_TTL)((trace, kingdom) => {
      this.updateRoom(trace, kingdom);
    });

    // Resources / logistics
    this.resources = null;
    this.hasStorage = false;
    this.threadUpdateResources = thread('update_resource', UPDATE_RESOURCES_TTL)((trace) => {
      // Storage
      this.hasStorage = this.getReserveStructures(false).length > 0;
      this.resources = this.updateReserveResources();
    });

    this.boosterPosition = null;
    this.boosterEffects = null;
    this.boosterAllEffects = null;
    this.boosterLabs = null;
    this.threadUpdateBoosters = thread('update_booster_thread', UPDATE_BOOSTER_TTL)((trace, room, kingdom) => {
      const topic = this.getTopics().getTopic(TOPIC_ROOM_BOOSTS);
      if (!topic) {
        trace.log('no topic');
        return;
      }

      topic.forEach((event) => {
        const details: BoosterDetails = event.details;
        trace.log('booster position', {details});

        this.boosterPosition = details.position;
        this.boosterEffects = details.availableEffects;
        this.boosterAllEffects = details.allEffects;
        this.boosterLabs = details.labsByResource;
      })
    });

    this.damagedCreeps = [];

    this.updateDamagedCreeps = thread('damaged_creeps', UPDATE_DAMAGED_CREEPS_TTL)(() => {
      let damagedCreeps = this.getCreeps().filter((creep) => {
        return creep.hits < creep.hitsMax;
      });
      damagedCreeps = _.sortBy(damagedCreeps, (creep) => {
        return creep.hits / creep.hitsMax;
      });
      this.damagedCreeps = _.map(damagedCreeps, 'name');
    });

    this.damagedStructures = [];
    this.updateDamagedStructure = thread('damaged_structures_thread', UPDATE_DAMAGED_STRUCTURES_TTL)(() => {
      const damagedStructures = this.room.find(FIND_STRUCTURES, {
        filter: (s) => {
          return s.hits < s.hitsMax && (
            s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART &&
            s.structureType != STRUCTURE_ROAD);
        },
      });

      this.damagedStructures = _.map(damagedStructures, 'id');
    });

    this.defenseHitsLimit = 10000;
    this.damagedSecondaryStructures = [];
    this.updateDamagedSecondaryStructures = thread('secondary_structures_thread', UPDATE_DAMAGED_SECONDARY_TTL)(() => {
      const room = Game.rooms[this.roomName];
      if (!room) {
        return;
      }

      const rcLevel = room.controller.level.toString();
      const rcLevelHitsMax = RAMPART_HITS_MAX[rcLevel] || 10000;

      const energyFullness = this.getEnergyFullness() * 10;
      this.defenseHitsLimit = rcLevelHitsMax * Math.pow(0.45, (10 - energyFullness));

      if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
        this.defenseHitsLimit = 10000;
      }

      // If energy in reserve is less then we need to sustain a max ugprader,
      // then limit the amount our defense hits
      const reserveEnergy = this.getAmountInReserve(RESOURCE_ENERGY);
      const reserveBuffer = this.getReserveBuffer();
      if (reserveEnergy < reserveBuffer + UPGRADER_BUFFER) {
        this.defenseHitsLimit = _.min([this.defenseHitsLimit, MAX_WALL_HITS]);
      }

      let damagedSecondaryStructures = this.room.find(FIND_STRUCTURES, {
        filter: (s) => {
          return s.hits < s.hitsMax && (
            s.structureType == STRUCTURE_RAMPART ||
            s.structureType == STRUCTURE_WALL) &&
            s.hits < this.defenseHitsLimit;
        },
      });
      damagedSecondaryStructures = _.sortBy(damagedSecondaryStructures, (structure) => {
        return structure.hits;
      });

      this.damagedSecondaryStructures = _.map(damagedSecondaryStructures, 'id');
      trace.log('damaged secondary structures', {
        room: this.roomName,
        defenseHitsLimit: this.defenseHitsLimit,
        damagedSecondaryStructures: this.damagedSecondaryStructures
      });
    });
  }

  update(trace) {
    trace = trace.begin('update');

    trace.log('room update');

    const base = this.getKingdom().getPlanner().getBaseConfigByRoom(this.roomName);
    if (!base) {
      trace.error('no base config for room');
      trace.end();
      return;
    }

    const room = this.room = Game.rooms[this.roomName];
    if (!room) {
      trace.error('room not visible');
      trace.end();
      return;
    }

    this.threadUpdateCreeps(trace, this.getKingdom());
    this.threadUpdateRoom(trace, this.getKingdom());

    if (this.isPrimary) {
      this.threadUpdateResources(trace);
      this.threadUpdateBoosters(trace);
      this.updateDamagedCreeps(trace);
      this.updateDamagedStructure(trace);
      this.updateDamagedSecondaryStructures(trace);
    }

    trace.end();
  }

  process(trace: Tracer) {
    const processTrace = trace.begin('process');

    processTrace.log('room process', {roomId: this.roomName});

    if (!this.room) {
      return;
    }

    this.updateStats(trace);

    processTrace.end();
  }
  getRoom() {
    return this;
  }
  getRoomObject() {
    return this.room;
  }
  getCreeps() {
    return this.assignedCreeps;
  }
  getSpawns() {
    return this.room.find(FIND_MY_SPAWNS);
  }
  getBoosterPosition(): RoomPosition {
    return this.boosterPosition;
  }
  getLoadedEffects(): EffectSet {
    return this.boosterEffects;
  }
  getAllEffects(): EffectSet {
    return this.boosterAllEffects;
  }
  getBoosterLabByResource(resource: ResourceConstant): StructureLab {
    return this.boosterLabs[resource];
  }

  getHostileStructures() {
    return this.hostileStructures;
  }

  getLabs(): StructureLab[] {
    return this.myStructures.filter((structure): structure is StructureLab => {
      return structure.structureType === STRUCTURE_LAB;
    });
  }
  getClosestStoreWithEnergy(creep) {
    if (this.room.storage) {
      return this.room.storage.id;
    }

    const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_CONTAINER &&
          structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
      },
    });

    if (container) {
      return container.id;
    }

    if (this.isPrimary) {
      return null;
    }

    return this.getColony().primaryOrgRoom.getClosestStoreWithEnergy(creep);
  }
  getReserveStructures(includeTerminal: boolean): AnyStoreStructure[] {
    const reserveStructures = [];

    if (!this.room) {
      return [];
    }

    if (this.room.storage?.isActive()) {
      reserveStructures.push(this.room.storage);
    }

    if (includeTerminal && this.room.terminal?.isActive()) {
      reserveStructures.push(this.room.terminal);
    }

    return reserveStructures;
  }
  getEnergyFullness(): number {
    const structures = this.getReserveStructures(false);
    if (!structures.length) {
      return 0;
    }

    const stores = structures.reduce((acc, structure) => {
      acc.capacity += structure.store.getCapacity(RESOURCE_ENERGY);
      acc.used += structure.store.getUsedCapacity(RESOURCE_ENERGY);
      return acc;
    }, {capacity: 0, used: 0});

    if (!stores.capacity) {
      return 0;
    }

    return stores.used / stores.capacity;
  }

  updateReserveResources(): ResourceCounts {
    const structures = this.getReserveStructures(true);
    return structures.reduce((acc, structure) => {
      Object.keys(structure.store).forEach((resource: ResourceConstant) => {
        const current = acc[resource] || 0;
        acc[resource] = structure.store.getUsedCapacity(resource) + current;
      });

      return acc;
    }, {});
  }

  getReserveResources(): ResourceCounts {
    // During initial ticks after a restart the cache may not be built, so build it
    if (!this.resources) {
      this.resources = this.updateReserveResources();
    }

    return this.resources;
  }

  getAmountInReserve(resource) {
    return this.getReserveResources()[resource] || 0;
  }

  getReserveStructureWithRoomForResource(resource) {
    let structures = this.getReserveStructures(false);
    if (!structures.length) {
      return null;
    }

    structures = _.sortBy(structures, (structure) => {
      return structure.store.getFreeCapacity(resource) || 0;
    }).reverse();

    return structures[0];
  }
  getReserveStructureWithMostOfAResource(resource, includeTerminal) {
    let structures = this.getReserveStructures(includeTerminal).filter((structure) => {
      const amount = structure.store.getUsedCapacity(resource) || 0;
      return amount > 0;
    });

    if (!structures.length) {
      return null;
    }

    structures = _.sortBy(structures, (structure) => {
      return structure.store.getUsedCapacity(resource) || 0;
    });

    return structures.pop();
  }

  getNextDamagedStructure(): Structure {
    let list = this.room.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_LIST] || [];
    let listTime = this.room.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_TIME] || 0;

    if (!listTime || Game.time - listTime > 20) {
      const targets = this.roomStructures.filter((structure) => {
        if (structure.structureType === STRUCTURE_INVADER_CORE) {
          return false;
        }

        return (
          (structure.hits < structure.hitsMax &&
            (
              structure.structureType != STRUCTURE_WALL &&
              structure.structureType != STRUCTURE_RAMPART
            )
          ) ||
          (structure.hits < WALL_LEVEL && structure.structureType === STRUCTURE_WALL) ||
          (structure.hits < RAMPART_LEVEL && structure.structureType === STRUCTURE_RAMPART)
        );
      });

      listTime = Game.time;
      list = [];

      if (targets.length) {
        list = _.sortBy(targets, (structure) => {
          return structure.hits / structure.hitsMax;
        });
      }

      list = list.map((structure) => {
        return structure.id;
      });
    }

    const next = list.shift();

    this.room.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_LIST] = list;
    this.room.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_TIME] = listTime;

    if (!next) {
      return null;
    }

    return Game.getObjectById<Id<Structure>>(next);
  }
  hasTerminal() {
    if (!this.room) {
      return false;
    }

    return !!this.room.terminal;
  }
  getMineralsWithExtractor() {
    const extractors = this.roomStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_EXTRACTOR;
    });

    return extractors.map((extractor) => {
      const minerals = extractor.pos.findInRange(FIND_MINERALS, 0);
      return minerals[0];
    });
  }

  updateStats(trace: Tracer) {
    const room = this.room;

    const roomStats: any = {
      sources: {},
    };

    trace.log('Updating stats for room:', room.name);

    roomStats.storageEnergy = (room.storage ? room.storage.store.energy : 0);
    roomStats.terminalEnergy = (room.terminal ? room.terminal.store.energy : 0);
    roomStats.energyAvailable = room.energyAvailable;
    roomStats.energyCapacityAvailable = room.energyCapacityAvailable;
    roomStats.controllerProgress = room.controller?.progress || 0;
    roomStats.controllerProgressTotal = room.controller?.progressTotal || 0;
    roomStats.controllerLevel = room.controller?.level;
    roomStats.resources = this.getReserveResources();

    const stats = this.getStats();
    stats.colonies[this.getColony().id].rooms[this.roomName] = roomStats;
  }

  getReserveBuffer() {
    if (!this.room.controller?.my) {
      return 0;
    }

    const roomLevel = this.getRoomLevel();

    if (roomLevel < 4) {
      return 2000;
    }

    return (roomLevel - 3) * PER_LEVEL_ENERGY;
  }

  getRoomLevel() {
    if (!this.room) {
      return 0;
    }

    if (!this.room.controller?.my) {
      return 0;
    }

    return this.room.controller.level;
  }

  getRoomLevelCompleted() {
    if (!this.room) {
      return 0;
    }

    if (!this.room.controller?.my) {
      return 0;
    }

    return this.room.controller.progress / this.room.controller.progressTotal;
  }

  getAlertLevel(): AlertLevel {
    return AlertLevel.GREEN;
  }

  requestSpawn(priority, details, ttl, trace: Tracer) {
    const base = this.getKingdom().getPlanner().getBaseConfigByRoom(this.room.name);
    if (!base) {
      trace.error('No base found for room:', this.room.name);
      return;
    }

    this.getKingdom().sendRequest(getBaseSpawnTopic(base.id), priority, details, ttl);
  }

  updateRoom(trace: Tracer, kingdom: Kingdom) {
    trace = trace.begin('common_room');

    const room = this.room;

    this.claimedByMe = room.controller?.my || false;
    this.reservedByMe = false;

    const username = kingdom.getPlanner().getUsername()
    const reservedBy = _.get(room, 'controller.reservation.username', null);
    if (reservedBy === username) {
      this.reservedByMe = true;
    }

    this.unowned = !this.room.controller?.reservation && !this.room.controller?.owner;

    // Defense
    this.stationFlags = [];
    const stationFlags = room.find(FIND_FLAGS, {
      filter: (flag) => {
        return flag.name.startsWith('station');
      },
    });
    trace.log('stationed defenders', {stationFlags});
    if (stationFlags.length) {
      this.stationFlags = stationFlags;
    }

    this.myStructures = this.room.find(FIND_MY_STRUCTURES);
    this.roomStructures = this.room.find(FIND_STRUCTURES);
    this.hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType !== STRUCTURE_CONTROLLER;
      },
    });

    trace.end();
  }

  updateCreeps(kingdom: Kingdom, trace: Tracer) {
    const updateCreepsTrace = trace.begin('update_creeps');

    this.assignedCreeps = kingdom.getRoomCreeps(this.roomName);
    this.defenderIds = this.assignedCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    }).map((defender) => {
      return defender.id;
    });

    updateCreepsTrace.end();
  }
}
