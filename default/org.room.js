
const OrgBase = require('./org.base');
const Link = require('./org.link');
const Tower = require('./org.tower');
const Terminal = require('./org.terminal');
const Topics = require('./lib.topics');
const Source = require('./org.source');
const MEMORY = require('./constants.memory');

const {MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_HARVEST_ROOM} = require('./constants.memory');
const {TOPIC_SPAWN, TOPIC_DEFENDERS} = require('./constants.topics');
const {WORKER_UPGRADER, WORKER_REPAIRER, WORKER_BUILDER, WORKER_DEFENDER} = require('./constants.creeps');
const {PRIORITY_UPGRADER, PRIORITY_BUILDER, PRIORITY_REPAIRER, PRIORITY_BOOTSTRAP,
  PRIORITY_REPAIRER_URGENT, PRIORITY_DEFENDER} = require('./constants.priorities');
const {WORKER_CLAIMER, WORKER_RESERVER, WORKER_DISTRIBUTOR, WORKER_HAULER} = require('./constants.creeps');
const {PRIORITY_RESERVER, PRIORITY_DISTRIBUTOR} = require('./constants.priorities');

const MIN_UPGRADERS = 2;
const MIN_DISTRIBUTORS = 2;
const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const MY_USERNAME = 'ENETDOWN';

class Room extends OrgBase {
  constructor(parent, room) {
    super(parent, room.name);

    this.topics = new Topics();

    this.roomObject = room; // preferred
    this.isPrimary = room.name === parent.primaryRoomId;
    this.claimedByMe = room.controller.my || false;
    this.reservedByMe = false;
    if (room.controller.reservation && room.controller.reservation.username === MY_USERNAME) {
      this.reservedByMe = true;
    }

    this.assignedCreeps = _.filter(parent.getCreeps(), (creep) => {
      return creep.memory[MEMORY_ASSIGN_ROOM] === room.name ||
        creep.memory[MEMORY_HARVEST_ROOM] === room.name;
    });

    this.hasClaimer = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_CLAIMER &&
        creep.memory[MEMORY_ASSIGN_ROOM] === room.name;
    }).length > 0;

    this.hasReserver = _.filter(this.assignedCreeps, (creep) => {
      const role = creep.memory[MEMORY_ROLE];
      return (role === WORKER_RESERVER || role === WORKER_CLAIMER) &&
        creep.memory[MEMORY_ASSIGN_ROOM] === room.name &&
        (creep.ticksToLive > (creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] || 100));
    }).length > 0;

    this.reservationTicks = 0;
    if (room.controller.reservation) {
      this.reservationTicks = room.controller.reservation.ticksToEnd;
    }

    this.myCreeps = room.find(FIND_MY_CREEPS);
    this.myDamagedCreeps = this.myCreeps.filter((creep) => {
      return creep.hits < creep.hitsMax;
    });

    this.numRepairers = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_REPAIRER &&
        (creep.ticksToLive > (creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] || 100));
    }).length;

    // Construction sites will help decide how many builders we need
    this.numConstructionSites = room.find(FIND_CONSTRUCTION_SITES).length;

    this.builders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_BUILDER &&
        (creep.ticksToLive > (creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] || 100));
    });

    this.upgraders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKER_UPGRADER &&
        (creep.ticksToLive > (creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] || 100));
    });

    this.distributors = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR &&
        creep.memory[MEMORY_ASSIGN_ROOM] === this.id &&
        creep.ticksToLive > 30;
    });
    this.numDistributors = this.distributors.length;

    this.hasStorage = this.getReserveStructures().length > 0;

    // We want to know if the room has hostiles, request defenders or put room in safe mode
    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    // TODO order hostiles by priority
    this.hostiles = hostiles;
    this.numHostiles = this.hostiles.length;

    this.hasInvaderCore = room.find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_INVADER_CORE;
      },
    }).length > 0;

    // We want to know if our defenses are being attacked
    this.lowHitsDefenses = room.find(FIND_STRUCTURES).filter((s) => {
      if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) {
        return false;
      }

      return s.hits < 1000;
    }).length;

    let maxHits = 0;
    let hits = 0;
    let numStructures = 0;
    room.find(FIND_STRUCTURES).forEach((s) => {
      if (s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART) {
        return;
      }

      numStructures++;

      if (s.hitsMax > 0 && s.hits > 0) {
        maxHits += s.hitsMax;
        hits += s.hits;
      }
    });
    let hitsPercentage = 1;
    if (maxHits > 0) {
      hitsPercentage = hits / maxHits;
    }
    this.hitsPercentage = hitsPercentage;
    this.numStructures = numStructures;

    const sources = [];
    const roomSources = this.getSources();
    roomSources.forEach((source) => {
      sources.push(new Source(this, source, 'energy'));
    });

    const minerals = this.getMineralsWithExtractor();
    minerals.forEach((mineral) => {
      if (mineral.mineralAmount > 0) {
        sources.push(new Source(this, mineral, 'mineral'));
      }
    });

    this.sources = sources;

    this.links = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_LINK;
      },
    }).map((link) => {
      return new Link(this, link);
    });

    // TODO build out org towers
    this.towers = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER;
      },
    }).map((tower) => {
      return new Tower(this, tower);
    });

    this.terminal = null;
    if (room.terminal) {
      this.terminal = new Terminal(this, room.terminal);
    }
  }
  update() {
    const controller = this.roomObject.controller;

    // If hostiles present spawn defenders and/or activate safe mode
    if (this.numHostiles || this.hasInvaderCore) {
      // If there are defenses low on
      if (controller && controller.my && this.lowHitsDefenses && controller.safeModeAvailable &&
        !controller.safeMode && !controller.safeModeCooldown) {
        console.log('ACTIVATING SAFEMODE!!!!!');
        controller.activateSafeMode();
      } else if (!controller.safeMode || controller.safeModeCooldown < 250) {
        // Request defenders
        this.sendRequest(TOPIC_DEFENDERS, PRIORITY_DEFENDER, {
          role: WORKER_DEFENDER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      }
    }

    // Send a request if we are short on distributors
    if (this.hasStorage && this.numDistributors < MIN_DISTRIBUTORS) {
      this.sendRequest(TOPIC_SPAWN, PRIORITY_DISTRIBUTOR, {
        role: WORKER_DISTRIBUTOR,
        memory: {
          [MEMORY_ASSIGN_ROOM]: this.id,
        },
      });
    }

    // If not claimed by me and no claimer assigned and not primary, request a reserver
    if (!this.hasReserver && (!this.reservedByMe && !this.claimedByMe && !this.numHostiles) ||
      (this.reservedByMe && this.reservationTicks < 1000)) {
      if (this.getColony().spawns.length) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_RESERVER, {
          role: WORKER_RESERVER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      } else {
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_RESERVER + 1, {
          role: WORKER_RESERVER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      }
    }

    // Upgrader request
    const fullness = this.getEnergyFullness();
    let desiredUpgraders = Math.ceil(fullness / 0.10);

    if (desiredUpgraders < MIN_UPGRADERS) {
      desiredUpgraders = MIN_UPGRADERS;
    }

    if (this.isPrimary && this.upgraders.length < desiredUpgraders) {
      // As we get more upgraders, lower the priority
      const upgraderPriority = PRIORITY_UPGRADER - (this.upgraders.length * 2);

      // TODO this will need to be expanded to support
      // multiple claims

      if (this.getColony().spawns.length) {
        this.sendRequest(TOPIC_SPAWN, upgraderPriority, {
          role: WORKER_UPGRADER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      } else {
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_BOOTSTRAP + upgraderPriority, {
          role: WORKER_UPGRADER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      }
    }

    // Builder requests
    if (this.builders.length < Math.ceil(this.numConstructionSites / 15)) {
      if (this.getColony().spawns.length) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_BUILDER - (this.builders.length * 2), {
          role: WORKER_BUILDER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      } else {
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_BOOTSTRAP + PRIORITY_BUILDER - this.builders.length, {
          role: WORKER_BUILDER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: this.id,
          },
        });
      }
    }

    // Repairer requests
    let desiredRepairers = 0;
    let repairerPriority = PRIORITY_REPAIRER;
    if (this.hitsPercentage < 0.8) {
      desiredRepairers = 1;
    }

    if (this.hitsPercentage < 0.6) {
      desiredRepairers = 2;
      repairerPriority = PRIORITY_REPAIRER_URGENT;
    }

    if (this.numStructures > 0 && this.numRepairers < desiredRepairers) {
      this.sendRequest(TOPIC_SPAWN, repairerPriority, {
        role: WORKER_REPAIRER,
        memory: {
          [MEMORY_ASSIGN_ROOM]: this.id,
        },
      });
    }

    console.log(this);

    this.sources.forEach((source) => {
      source.update();
    });

    this.links.forEach((link) => {
      link.update();
    });

    this.towers.forEach((tower) => {
      tower.update();
    });

    if (this.terminal) {
      this.terminal.update();
    }
  }
  process() {
    this.updateStats();

    this.sources.forEach((source) => {
      source.process();
    });

    this.links.forEach((link) => {
      link.process();
    });

    this.towers.forEach((tower) => {
      tower.process();
    });

    if (this.terminal) {
      this.terminal.process();
    }
  }
  toString() {
    return `-- Room - ID: ${this.id}, Primary: ${this.isPrimary}, Claimed: ${this.claimedByMe}, ` +
      `Claimers: ${this.hasClaimer}, #Builders: ${this.builders.length}, ` +
      `#Upgraders: ${this.upgraders.length}, #Hostiles: ${this.numHostiles}, ` +
      `#Towers: ${this.towers.length}, #Sites: ${this.numConstructionSites}, ` +
      `%Hits: ${this.hitsPercentage.toFixed(2)}, #Repairer: ${this.numRepairers}, ` +
      `#Links: ${this.links.length}, #Distributors: ${this.numDistributors}, ` +
      `EnergyFullness: ${this.getEnergyFullness()}`;
  }
  getRoom() {
    return this;
  }
  getRoomObject() {
    return this.roomObject;
  }
  getCreeps() {
    return this.assignedCreeps;
  }
  getSources() {
    return this.roomObject.find(FIND_SOURCES);
  }
  getSpawns() {
    return this.roomObject.find(FIND_MY_SPAWNS);
  }
  getHostiles() {
    return this.hostiles;
  }
  getMyCreeps() {
    return this.myCreeps;
  }
  getClosestStoreWithEnergy(creep) {
    if (this.roomObject.storage) {
      return this.roomObject.storage.id;
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
  getReserveStructures() {
    if (this.roomObject.storage) {
      return [this.roomObject.storage];
    }

    const room = this.roomObject;
    const spawns = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_SPAWN;
      },
    });

    if (!spawns.length) {
      return [];
    }

    const stores = _.reduce(spawns, (acc, spawn) => {
      const containers = spawn.pos.findInRange(FIND_STRUCTURES, 9, {
        filter: (structure) => {
          if (structure.structureType !== STRUCTURE_CONTAINER) {
            return false
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

    return stores.used / stores.capacity;
  }
  getReserveResources() {
    const structures = this.getReserveStructures();

    return structures.reduce((acc, structure) => {
      Object.keys(structure.store).forEach((resource) => {
        const current = acc[resource] || 0;
        acc[resource] = structure.store.getUsedCapacity(resource) + current;
      });

      return acc;
    }, {});
  }
  getAmountInReserve(resource) {
    return this.getReserveResources()[resource] || 0;
  }
  getReserveStructureWithRoomForResource(resource) {
    let structures = this.getReserveStructures(resource);
    if (!structures.length) {
      return null;
    }

    structures = _.sortBy(structures, (structure) => {
      return structure.store.getFreeCapacity(resource) || 0;
    }).reverse();

    return structures[0];
  }
  getReserveStructureWithMostOfAResource(resource) {
    let structures = this.getReserveStructures(resource).filter((structure) => {
      const amount = structure.store.getUsedCapacity(resource) || 0;
      return amount > 0;
    });

    if (!structures.length) {
      return null;
    }

    structures = _.sortBy(structures, (structure) => {
      return structure.store.getUsedCapacity(resource) || 0;
    });

    return structures[0];
  }
  getNextEnergyStructure(creep) {
    let list = this.roomObject.memory[MEMORY.ROOM_NEEDS_ENERGY_LIST] || [];
    const listTime = this.roomObject.memory[MEMORY.ROOM_NEEDS_ENERGY_TIME] || Game.time;

    if (!list || !list.length || !listTime || Game.time - listTime > 20) {
      const room = this.roomObject;

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

      list = room.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return ( // Fill extensions and spawns with room
            (structure.structureType == STRUCTURE_EXTENSION ||
              structure.structureType == STRUCTURE_SPAWN) &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          );
        },
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
    }

    list = _.sortBy(list, (id) => {
      return creep.pos.getRangeTo(Game.getObjectById(id));
    });

    const next = list.shift();

    this.roomObject.memory[MEMORY.ROOM_NEEDS_ENERGY_LIST] = list;
    this.roomObject.memory[MEMORY.ROOM_NEEDS_ENERGY_TIME] = listTime;

    if (!next) {
      return null;
    }

    return Game.getObjectById(next);
  }
  getNextDamagedStructure() {
    let list = this.roomObject.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_LIST] || [];
    let listTime = this.roomObject.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_TIME] || 0;

    if (!listTime || Game.time - listTime > 20) {
      const targets = this.roomObject.find(FIND_STRUCTURES, {
        filter: (structure) => {
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
        },
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

    this.roomObject.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_LIST] = list;
    this.roomObject.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_TIME] = listTime;

    if (!next) {
      return null;
    }

    return Game.getObjectById(next);
  }
  getParkingLot() {
    const parkingLots = this.roomObject.find(FIND_FLAGS, {
      filter: (flag) => {
        return flag.name.startsWith('parking');
      },
    });

    if (!parkingLots.length) {
      return null;
    }

    return parkingLots[0];
  }
  getMineralsWithExtractor() {
    const extractors = this.roomObject.find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_EXTRACTOR;
      },
    });

    return extractors.map((extractor) => {
      const minerals = extractor.pos.findInRange(FIND_MINERALS, 0);
      return minerals[0];
    });
  }
  updateStats() {
    const room = this.roomObject;

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

    const stats = this.getStats();
    stats.colonies[this.getColony().id].rooms[this.id] = roomStats;
  }
}

module.exports = Room;
