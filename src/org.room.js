const {OrgBase} = require('./org.base');

const CREEPS = require('./constants.creeps');
const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');
const {creepIsFresh} = require('./behavior.commute');
const {thread} = require('./os.thread');

const {MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_HARVEST_ROOM} = require('./constants.memory');
const {TOPIC_SPAWN} = require('./constants.topics');
const {WORKER_DISTRIBUTOR, WORKER_HAULER} = require('./constants.creeps');

const MEMORY_HOSTILE_TIME = 'hostile_time';
const MEMORY_HOSTILE_POS = 'hostile_pos';

const MAX_DEFENDERS = 4;

const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const MY_USERNAME = 'ENETDOWN';
const PER_LEVEL_ENERGY = 150000;

const UPDATE_CREEPS_TTL = 1;
const UPDATE_ROOM_TTL = 10;
const UPDATE_ORG_TTL = 10;
const UPDATE_RESOURCES_TTL = 5;

const UPDATE_DEFENSE_STATUS_TTL = 5;
const UPDATE_DAMAGED_CREEPS_TTL = 5;
const UPDATE_DAMAGED_STRUCTURES_TTL = 20;
const UPDATE_DAMAGED_SECONDARY_TTL = 15;
const UPDATE_DAMAGED_ROADS_TTL = 25;

const REQUEST_DEFENDERS_TTL = 20;
const REQUEST_DEFENDERS_DELAY = 20;
const HOSTILE_PRESENCE_TTL = 200;

class Room extends OrgBase {
  constructor(parent, room, trace) {
    super(parent, room.name, trace);

    const setupTrace = this.trace.begin('constructor');

    this.room = room;
    this.isPrimary = room.name === parent.primaryRoomId;
    this.isPublic = parent.isPublic;

    // Creeps
    this.assignedCreeps = [];
    this.defenderIds = [];
    this.threadUpdateCreeps = thread(UPDATE_CREEPS_TTL)((trace) => {
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
    this.threadUpdateRoom = thread(UPDATE_ROOM_TTL)((trace) => {
      this.updateRoom(trace);
    });

    // Primary room
    // this.reactorMap = {};
    // this.booster = null;
    // this.terminal = null;
    this.hasSpawns = false;
    this.threadUpdatePrimary = thread(UPDATE_ORG_TTL)((trace) => {
      this.updatePrimary(trace);
    });

    // Resources / logistics
    this.resources = {};
    this.hasStorage = false;
    this.threadUpdateResources = thread(UPDATE_RESOURCES_TTL)(() => {
      // Storage
      this.hasStorage = this.getReserveStructures().length > 0;
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
    this.threadUpdateDefenseStatus = thread(UPDATE_DEFENSE_STATUS_TTL)((room, trace) => {
      this.updateDefenseStatus(room, trace);
    });

    this.damagedCreeps = [];
    this.updateDamagedCreeps = thread(UPDATE_DAMAGED_CREEPS_TTL)(() => {
      let damagedCreeps = this.getCreeps().filter((creep) => {
        return creep.hits < creep.hitsMax;
      });
      damagedCreeps = _.sortBy(damagedCreeps, (creep) => {
        return creep.hits / creep.hitsMax;
      });
      this.damagedCreeps = _.map(damagedCreeps, 'name');
    });

    this.damagedStructures = [];
    this.updateDamagedStructure = thread(UPDATE_DAMAGED_STRUCTURES_TTL)(() => {
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
    this.updateDamagedSecondaryStructures = thread(UPDATE_DAMAGED_SECONDARY_TTL)(() => {
      const rcLevel = room.controller.level.toString();
      const rcLevelHitsMax = RAMPART_HITS_MAX[rcLevel] || 10000;

      const energyFullness = this.getEnergyFullness() * 10;
      this.defenseHitsLimit = rcLevelHitsMax * Math.pow(0.45, (10 - energyFullness));

      if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
        this.defenseHitsLimit = 10000;
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
    this.updateDamagedRoads = thread(UPDATE_DAMAGED_ROADS_TTL)(() => {
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

    this.threadRequestDefenders = thread(REQUEST_DEFENDERS_TTL)((trace) => {
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

      if (!this.primaryRoom && this.defendersLost >= 3) {
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

      this.requestDefender(this.lastHostilePosition, true, trace);
    });

    setupTrace.end();
  }

  update(trace) {
    trace = trace.asId(this.id);
    const updateTrace = trace.begin('update');

    updateTrace.log('room update', {roomId: this.id});

    const room = this.room = Game.rooms[this.id];
    if (!room) {
      if (Game.time - this.hostileTime > HOSTILE_PRESENCE_TTL) {
        trace.log('past hostile presence ttl, clearing hostiles');
        this.hostile = [];
        this.numHostiles = 0;
        this.defendersLost = 0;
      }

      this.threadRequestDefenders(trace);

      updateTrace.end();
      return;
    }

    updateTrace.log('reading events', {roomId: room.name});
    room.getEventLog().forEach((msg) => {
      if (msg.event === EVENT_OBJECT_DESTROYED && msg.data.type === 'creep') {
        if (this.defenderIds.indexOf(msg.objectId) > -1) {
          trace.log('lost a defender', {defenderId: msg.objectId});
          this.defendersLost += 1;
        }
      }
    });

    this.threadUpdateCreeps(updateTrace);
    this.threadUpdateDefenseStatus(room, updateTrace);
    this.threadUpdateRoom(updateTrace);

    if (this.isPrimary) {
      this.threadUpdatePrimary(updateTrace);
      this.threadUpdateResources(updateTrace);

      const towerFocusTrace = updateTrace.begin('tower_focus');
      this.updateDamagedCreeps();
      this.updateDamagedStructure();
      this.updateDamagedSecondaryStructures();
      this.updateDamagedRoads();
      towerFocusTrace.end();
    }

    const requestTrace = updateTrace.begin('requests');

    // Request defenders
    this.threadRequestDefenders(trace);

    requestTrace.end();

    updateTrace.end();
  }
  process(trace) {
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
  getLabs() {
    return this.myStructures.filter((structure) => {
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

    return this.getColony().primaryRoom.getClosestStoreWithEnergy(creep);
  }
  getReserveStructures(includeTerminal = false) {
    const reserveStructures = [];

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
  getEnergyFullness() {
    const structures = this.getReserveStructures();
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
      Object.keys(structure.store).forEach((resource) => {
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
    let structures = this.getReserveStructures();
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
  getNextEnergyStructure(creep) {
    let list = this.room.memory[MEMORY.ROOM_NEEDS_ENERGY_LIST] || [];
    let listTime = this.room.memory[MEMORY.ROOM_NEEDS_ENERGY_TIME] || Game.time;

    if (!list || !list.length || !listTime || Game.time - listTime > 20) {
      const room = this.room;

      // We will subtract structures already being serviced by a creep
      const assignedDestinations = _.reduce(this.assignedCreeps, (acc, c) => {
        if (c.room.name !== room.name) {
          return acc;
        }

        if (c.memory[MEMORY.MEMORY_ROLE] !== WORKER_DISTRIBUTOR &&
          c.memory[MEMORY.MEMORY_ROLE] !== WORKER_HAULER) {
          return acc;
        }

        if (c.memory[MEMORY.MEMORY_DESTINATION]) {
          return acc;
        }

        acc.push(c.memory[MEMORY.MEMORY_DESTINATION]);

        return acc;
      }, []);

      list = this.myStructures.filter((structure) => {
        return ( // Fill extensions and spawns with room
          (structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_SPAWN
          ) && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
      });

      // We get a a deadlock if there are fewer sources than distributors
      if (list.length > 2) {
        // Filter out destinations that are already assigned to another Distributor
        list = _.filter(list, (structure) => {
          return assignedDestinations.indexOf(structure.id) === -1;
        });
      }

      list = list.map((structure) => {
        return structure.id;
      });

      listTime = Game.time;
    }

    list = _.sortBy(list, (id) => {
      return creep.pos.getRangeTo(Game.getObjectById(id));
    });

    const next = list.shift();

    this.room.memory[MEMORY.ROOM_NEEDS_ENERGY_LIST] = list;
    this.room.memory[MEMORY.ROOM_NEEDS_ENERGY_TIME] = listTime;

    if (!next) {
      return null;
    }

    return Game.getObjectById(next);
  }
  getNextDamagedStructure() {
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

    return Game.getObjectById(next);
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

    const roomStats = {
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
      return creep.memory[MEMORY_ROLE] === CREEPS.WORKER_DEFENDER;
    }).map((defender) => {
      return defender.id;
    });

    updateCreepsTrace.end();
  }
  updateDefenseStatus(room, trace) {
    const defenseTrace = trace.begin('defenses');

    // We want to know if the room has hostiles, request defenders or put room in safe mode
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    // TODO order hostiles by priority
    this.hostiles = hostiles;
    this.numHostiles = this.hostiles.length;

    this.numDefenders = this.room.find(FIND_MY_CREEPS, {
      filter: (creep) => {
        return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER;
      },
    }).length;

    trace.log('hostile presence', {
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

      trace.log('set hostile time', {
        hostileTime: this.hostileTime,
      });

      // Update where we want defenders to go
      const hostile = this.hostiles[0];
      this.lastHostilePosition = [hostile.pos.x, hostile.pos.y, hostile.pos.roomName].join(',');
      room.memory[MEMORY_HOSTILE_POS] = this.lastHostilePosition;
    } else if (!this.isHostile(trace)) {
      this.defendersLost = 0;
      trace.log('clear hostile time');
    }

    this.invaderCores = this.roomStructures.filter((structure) => {
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

module.exports = Room;
