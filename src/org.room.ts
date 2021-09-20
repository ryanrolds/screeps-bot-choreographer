import {OrgBase} from './org.base';
import {Colony} from './org.colony';

import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as TOPICS from './constants.topics';
import * as PRIORITIES from './constants.priorities';
import {creepIsFresh} from './behavior.commute';
import {thread, ThreadFunc} from './os.thread';
import {Tracer} from './lib.tracing'

import {MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_HARVEST_ROOM} from './constants.memory';
import {TOPIC_SPAWN} from './constants.topics';
import {WORKER_HAULER} from './constants.creeps';
import {Kingdom} from './org.kingdom';
import BoosterRunnable, {BoosterDetails, EffectSet, LabsByResource, TOPIC_ROOM_BOOSTS} from './runnable.booster';

export const TOPIC_ROOM_KEYVALUE = 'room_keyvalue';
const MEMORY_HOSTILE_TIME = 'hostile_time';
const MEMORY_HOSTILE_POS = 'hostile_pos';

const MAX_DEFENDERS = 8;

const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const MY_USERNAME = 'ENETDOWN';
const PER_LEVEL_ENERGY = 100000;
const UPGRADER_BUFFER = 25000;
// TODO increase this later, we should be able to sustain at least one nuke
// before the walls break
const MAX_WALL_HITS = 11000000;

const UPDATE_CREEPS_TTL = 1;
const UPDATE_ROOM_TTL = 10;
const UPDATE_ORG_TTL = 10;
const UPDATE_RESOURCES_TTL = 5;
const UPDATE_BOOSTER_TTL = 5;

const UPDATE_DEFENSE_STATUS_TTL = 5;
const UPDATE_DAMAGED_CREEPS_TTL = 5;
const UPDATE_DAMAGED_STRUCTURES_TTL = 20;
const UPDATE_DAMAGED_SECONDARY_TTL = 15;
const UPDATE_DAMAGED_ROADS_TTL = 25;

const REQUEST_DEFENDERS_TTL = 20;
const REQUEST_DEFENDERS_DELAY = 20;
const HOSTILE_PRESENCE_TTL = 200;

enum RoomAlertLevel {
  GREEN = "green",
  YELLO = "yellow",
  RED = "red",
};

export default class OrgRoom extends OrgBase {
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
  parkingLot: Flag;
  hasSpawns: boolean;
  resources: Partial<Record<ResourceConstant, number>>;
  hasStorage: boolean;

  hostileTime: number;
  hostileTimes: Record<number, number>;
  lastHostilePosition: string;
  hostiles: Creep[];
  numHostiles: number;
  numDefenders: number;
  defendersLost: number;
  invaderCores: StructureInvaderCore[];
  lowHitsDefenses: number;

  damagedCreeps: string[];
  damagedStructures: Id<AnyStructure>[];
  defenseHitsLimit: number;
  damagedSecondaryStructures: Id<AnyStructure>[];
  damagedRoads: Id<AnyStructure>[];

  stationFlags: Flag[];

  threadUpdateCreeps: ThreadFunc;
  threadUpdateRoom: ThreadFunc;
  threadUpdatePrimary: ThreadFunc;
  threadUpdateResources: ThreadFunc;
  threadUpdateDefenseStatus: ThreadFunc;
  threadUpdateDamagedCreeps: ThreadFunc;
  threadUpdateBoosters: ThreadFunc;
  updateDamagedCreeps: ThreadFunc;
  updateDamagedStructure: ThreadFunc;
  updateDamagedSecondaryStructures: ThreadFunc;
  updateDamagedRoads: ThreadFunc;
  threadRequestDefenders: ThreadFunc;

  boosterAllEffects: EffectSet;
  boosterEffects: EffectSet;
  boosterPosition: RoomPosition;
  boosterLabs: LabsByResource;;

  constructor(parent: Colony, room: Room, trace: Tracer) {
    super(parent, room.name, trace);

    const setupTrace = this.trace.begin('constructor');

    this.room = room;
    this.isPrimary = room.name === parent.primaryRoomId;
    this.isPublic = parent.isPublic;

    // Creeps
    this.assignedCreeps = [];
    this.defenderIds = [];
    this.threadUpdateCreeps = thread('update_creeps_thread', UPDATE_CREEPS_TTL)((trace) => {
      this.updateCreeps(trace);
    });

    // Common room
    this.unowned = true;
    this.claimedByMe = false;
    this.reservedByMe = false;
    this.myStructures = [];
    this.roomStructures = [];
    this.hostileStructures = [];
    this.parkingLot = null;
    this.threadUpdateRoom = thread('update_room_thread', UPDATE_ROOM_TTL)((trace) => {
      this.updateRoom(trace);
    });

    // Primary room
    this.hasSpawns = false;
    this.threadUpdatePrimary = thread('update_primary', UPDATE_ORG_TTL)((trace) => {
      this.updatePrimary(trace);
    });

    // Resources / logistics
    this.resources = {};
    this.hasStorage = false;
    this.threadUpdateResources = thread('update_resource', UPDATE_RESOURCES_TTL)((trace) => {
      // Storage
      this.hasStorage = this.getReserveStructures(false).length > 0;
      this.resources = this.getReserveResources(true);
    });

    // Defense status
    this.hostileTime = room.memory[MEMORY_HOSTILE_TIME] || 0;
    this.hostileTimes = {};
    this.lastHostilePosition = room.memory[MEMORY_HOSTILE_POS] || null;
    this.hostiles = [];
    this.numHostiles = 0;
    this.numDefenders = 0;
    this.defendersLost = 0;
    this.invaderCores = [];
    this.threadUpdateDefenseStatus = thread('defense_status_thread', UPDATE_DEFENSE_STATUS_TTL)((trace, room, kingdom) => {
      this.updateDefenseStatus(kingdom, room, trace);
    });

    this.boosterPosition = null;
    this.boosterEffects = null;
    this.boosterAllEffects = null;
    this.boosterLabs = null;
    this.threadUpdateBoosters = thread('update_booster_thread', UPDATE_BOOSTER_TTL)((trace, room, kingdom) => {
      this.boosterPosition = null;
      this.boosterEffects = null;
      this.boosterAllEffects = null;
      this.boosterLabs = null;

      this.getTopics().getTopic(TOPIC_ROOM_BOOSTS).forEach((event: BoosterDetails) => {
        this.boosterPosition = event.position;
        this.boosterEffects = event.availableEffects;
        this.boosterAllEffects = event.allEffects;
        this.boosterLabs = event.labsByResource;
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
      const rcLevel = room.controller.level.toString();
      const rcLevelHitsMax = RAMPART_HITS_MAX[rcLevel] || 10000;

      const energyFullness = this.getEnergyFullness() * 10;
      this.defenseHitsLimit = rcLevelHitsMax * Math.pow(0.45, (10 - energyFullness));

      if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
        this.defenseHitsLimit = 10000;
      }

      // If energy in reserve is less then we need to sustain a max ugprader,
      // then limit the amount our defense hits
      const reserveEnergy = this.getAmountInReserve(RESOURCE_ENERGY, false);
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
    });

    this.damagedRoads = [];
    this.updateDamagedRoads = thread('update_damaged_roads_thread', UPDATE_DAMAGED_ROADS_TTL)(() => {
      let damagedRoads = this.room.find(FIND_STRUCTURES, {
        filter: (s) => {
          return s.hits < s.hitsMax && s.structureType == STRUCTURE_ROAD;
        },
      });
      damagedRoads = _.sortBy(damagedRoads, (structure) => {
        return structure.hits;
      });

      this.damagedRoads = _.map(damagedRoads, 'id');
    });

    this.threadRequestDefenders = thread('request_defenders_thread', REQUEST_DEFENDERS_TTL)((trace) => {
      const freshDefenders = this.getColony().defenders.filter((defender) => {
        return creepIsFresh(defender);
      });

      trace.log('existing defenders', {freshDefenders: freshDefenders.length, MAX_DEFENDERS});

      const neededDefenders = MAX_DEFENDERS - freshDefenders.length;
      if (neededDefenders <= 0) {
        trace.log('do not need defenders: full');
        return;
      }

      if (this.stationFlags.length) {
        const flag = this.stationFlags[0];
        const position = [flag.pos.x, flag.pos.y, flag.pos.roomName].join(',');
        trace.log('request defenders to flag');
        this.requestDefender(position, true, trace);
        return;
      }

      const enemyPresent = this.hostiles.length || this.invaderCores.length;
      const enemyPresentRecently = Game.time - this.hostileTime < HOSTILE_PRESENCE_TTL;
      if (!enemyPresent || !enemyPresentRecently) {
        trace.log('do not request defender: room is quiet');
        return;
      }

      trace.log('checking if we need defenders to handle hostile presence', {
        enemyPresent,
        enemyPresentRecently,
        hostileTime: this.hostileTime,
        defendersLost: this.defendersLost,
      });

      let controller = null;
      if (this.room && this.room.controller) {
        controller = this.room.controller;
      }

      if (controller && (controller.safeMode && controller.safeMode > 250)) {
        trace.log('do not request defenders: in safe mode', {safeMode: controller.safeMode});
        return;
      }

      if (!this.isPrimary && this.defendersLost >= 3) {
        trace.log('do not request defender: we have lost too many defenders');
      }

      const pastDelay = Game.time - this.hostileTime >= REQUEST_DEFENDERS_DELAY;
      if (!pastDelay) {
        trace.log('do not request defender: waiting to see if they leave', {
          pastDelay,
          age: Game.time - this.hostileTime,
          REQUEST_DEFENDERS_DELAY,
        });
        return;
      }

      for (let i = 0; i < neededDefenders; i++) {
        this.requestDefender(this.lastHostilePosition, true, trace);
      }
    });

    setupTrace.end();
  }

  update(trace) {
    trace = trace.asId(this.id).begin('update');

    trace.log('room update', {roomId: this.id});

    const room = this.room = Game.rooms[this.id];
    if (!room) {
      if (Game.time - this.hostileTime > HOSTILE_PRESENCE_TTL) {
        trace.log('past hostile presence ttl, clearing hostiles');
        this.hostiles = [];
        this.numHostiles = 0;
        this.defendersLost = 0;
      }

      this.threadRequestDefenders(trace);

      trace.end();
      return;
    }

    trace.log('reading events', {roomId: room.name});
    room.getEventLog().forEach((msg) => {
      if (msg.event === EVENT_OBJECT_DESTROYED && msg.data.type === 'creep') {
        if (this.defenderIds.indexOf(msg.objectId as Id<Creep>) > -1) {
          trace.log('lost a defender', {defenderId: msg.objectId});
          this.defendersLost += 1;
        }
      }
    });

    this.threadUpdateCreeps(trace);
    this.threadUpdateDefenseStatus(trace, room, this.getKingdom());
    this.threadUpdateRoom(trace);

    if (this.isPrimary) {
      this.threadUpdatePrimary(trace);
      this.threadUpdateResources(trace);
      this.updateDamagedCreeps(trace);
      this.updateDamagedStructure(trace);
      this.updateDamagedSecondaryStructures(trace);
      this.updateDamagedRoads(trace);
    }

    // Request defenders
    this.threadRequestDefenders(trace);

    trace.end();
  }
  process(trace: Tracer) {
    trace = trace.asId(this.id);
    const processTrace = trace.begin('process');

    processTrace.log('room process', {roomId: this.id});

    if (!this.room) {
      return;
    }

    this.updateStats();

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
  getHostiles() {
    return this.hostiles;
  }
  getInvaderCores() {
    return this.invaderCores;
  }
  getHostileStructures() {
    return this.hostileStructures;
  }
  isHostile(trace) {
    const notQuite = this.numHostiles ||
      (this.hostileTime !== 0 && Game.time - this.hostileTime < HOSTILE_PRESENCE_TTL);

    trace.log('checking for hostiles', {
      numHostiles: this.numHostiles,
      numDefenders: this.numDefenders,
      hostileTime: this.hostileTime,
      HOSTILE_PRESENCE_TTL,
      lastPresence: Game.time - this.hostileTime,
      notQuite,
    });

    if (this.numDefenders) {
      return false;
    }

    return notQuite;
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

    if (this.room.storage) {
      reserveStructures.push(this.room.storage);
    }

    if (includeTerminal && this.room.terminal) {
      reserveStructures.push(this.room.terminal);
    }

    if (reserveStructures.length) {
      return reserveStructures;
    }

    const spawns = this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_SPAWN;
    });

    if (!spawns.length) {
      return [];
    }

    const stores = _.reduce(spawns, (acc, spawn) => {
      const containers = spawn.pos.findInRange(FIND_STRUCTURES, 9, {
        filter: (structure) => {
          if (structure.structureType !== STRUCTURE_CONTAINER) {
            return false;
          }

          const notSourceContainer = structure.pos.findInRange(FIND_SOURCES, 1).length < 1;
          return notSourceContainer;
        },
      });

      return acc.concat(containers);
    }, []);

    return stores;
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
  getReserveResources(includeTerminal) {
    const structures = this.getReserveStructures(includeTerminal);

    return structures.reduce((acc, structure) => {
      Object.keys(structure.store).forEach((resource: ResourceConstant) => {
        const current = acc[resource] || 0;
        acc[resource] = structure.store.getUsedCapacity(resource) + current;
      });

      return acc;
    }, {});
  }
  getAmountInReserve(resource, includeTerminal) {
    return this.getReserveResources(includeTerminal)[resource] || 0;
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
  getParkingLot() {
    return this.parkingLot;
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

  updateStats() {
    const room = this.room;

    const roomStats: any = {
      sources: {},
    };

    roomStats.storageEnergy = (room.storage ? room.storage.store.energy : 0);
    roomStats.terminalEnergy = (room.terminal ? room.terminal.store.energy : 0);
    roomStats.energyAvailable = room.energyAvailable;
    roomStats.energyCapacityAvailable = room.energyCapacityAvailable;
    roomStats.controllerProgress = room.controller.progress;
    roomStats.controllerProgressTotal = room.controller.progressTotal;
    roomStats.controllerLevel = room.controller.level;
    roomStats.resources = this.resources;

    const stats = this.getStats();
    stats.colonies[this.getColony().id].rooms[this.id] = roomStats;
  }

  requestDefender(position, spawn, trace) {
    trace.log('requesting defender', {position, spawn});

    this.sendRequest(TOPICS.TOPIC_DEFENDERS, PRIORITIES.PRIORITY_DEFENDER, {
      role: CREEPS.WORKER_DEFENDER,
      spawn,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_ASSIGN_ROOM_POS]: position,
      },
    }, REQUEST_DEFENDERS_TTL);
  }

  getReserveBuffer() {
    if (!this.room.controller.my) {
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

    if (!this.room.controller.my) {
      return 0;
    }

    return this.room.controller.level;
  }

  getRoomLevelCompleted() {
    if (!this.room) {
      return 0;
    }

    if (!this.room.controller.my) {
      return 0;
    }

    return this.room.controller.progress / this.room.controller.progressTotal;
  }

  getAlertLevel(): RoomAlertLevel {
    return RoomAlertLevel.GREEN;
  }

  requestSpawn(priority, details, ttl) {
    if (this.getColony().getPrimaryRoom().hasSpawns) {
      this.sendRequest(TOPIC_SPAWN, priority, details, ttl);
    } else {
      this.getKingdom().sendRequest(TOPIC_SPAWN, priority, details, ttl);
    }
  }
  updateRoom(trace) {
    trace = trace.begin('common_room');

    const room = this.room;

    this.claimedByMe = room.controller.my || false;
    this.reservedByMe = false;
    if (room.controller.reservation && room.controller.reservation.username === MY_USERNAME) {
      this.reservedByMe = true;
    }

    this.unowned = !this.room.controller.reservation && !this.room.controller.owner;

    // Parking lot
    this.parkingLot = null;
    const parkingLots = room.find(FIND_FLAGS, {
      filter: (flag) => {
        return flag.name.startsWith('parking');
      },
    });
    if (parkingLots.length) {
      this.parkingLot = parkingLots[0];
    }

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
  updatePrimary(trace) {
    trace = trace.begin('primary_room');

    // Spawns
    const roomSpawns = this.getSpawns();
    this.hasSpawns = roomSpawns.length > 0;

    trace.end();
  }
  updateCreeps(trace) {
    const updateCreepsTrace = trace.begin('update_creeps');

    this.assignedCreeps = _.filter(Game.creeps, (creep) => {
      return (creep.memory[MEMORY_ASSIGN_ROOM] === this.room.name ||
        creep.memory[MEMORY_HARVEST_ROOM] === this.room.name) || (
          creep.memory[MEMORY_ROLE] === WORKER_HAULER && creep.room.name === this.room.name);
    });

    this.defenderIds = this.assignedCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    }).map((defender) => {
      return defender.id;
    });

    updateCreepsTrace.end();
  }
  updateDefenseStatus(kingdom: Kingdom, room: Room, trace: Tracer) {
    const defenseTrace = trace.begin('defenses');

    // We want to know if the room has hostiles, request defenders or put room in safe mode
    let hostiles = room.find(FIND_HOSTILE_CREEPS);

    // Filter friendly creeps
    const friends = kingdom.config.friends;
    hostiles = hostiles.filter(creep => friends.indexOf(creep.owner.username) === -1);

    this.hostiles = hostiles;
    this.numHostiles = this.hostiles.length;

    this.numDefenders = room.find(FIND_MY_CREEPS, {
      filter: (creep) => {
        const role = creep.memory[MEMORY.MEMORY_ROLE];
        return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
          role === CREEPS.WORKER_DEFENDER_BOOSTED;
      },
    }).length;

    defenseTrace.log('hostile presence', {
      numHostiles: this.numHostiles,
      numDefenders: this.numDefenders,
      hostileTime: this.hostileTime,
      defendersLost: this.defendersLost,
    });

    if (!this.hostiles.length) {
      this.hostileTimes = {};
    }

    if (this.hostiles.length) {
      this.hostileTimes = this.hostiles.reduce((times, hostile) => {
        if (!times[hostile.id]) {
          times[hostile.id] = Game.time;
        }

        return times;
      }, this.hostileTimes);

      this.hostileTime = Math.min(...Object.values(this.hostileTimes));
      room.memory[MEMORY_HOSTILE_TIME] = this.hostileTime;

      defenseTrace.log('set hostile time', {
        hostileTime: this.hostileTime,
      });

      // Update where we want defenders to go
      const hostile = this.hostiles[0];
      this.lastHostilePosition = [hostile.pos.x, hostile.pos.y, hostile.pos.roomName].join(',');
      room.memory[MEMORY_HOSTILE_POS] = this.lastHostilePosition;
    } else if (!this.isHostile(defenseTrace)) {
      this.defendersLost = 0;
      defenseTrace.log('clear hostile time');
    }

    this.invaderCores = this.roomStructures.filter((structure): structure is StructureInvaderCore => {
      return structure.structureType === STRUCTURE_INVADER_CORE;
    });

    // We want to know if our defenses are being attacked
    this.lowHitsDefenses = this.roomStructures.filter((s) => {
      if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) {
        return false;
      }

      return s.hits < 1000;
    }).length;

    defenseTrace.end();
  }
}
