
const OrgBase = require('./org.base');
const Link = require('./org.link');
const Tower = require('./org.tower');
const Terminal = require('./org.terminal');
const Source = require('./org.source');
const Booster = require('./org.booster');
const Reactor = require('./org.reactor');

const CREEPS = require('./constants.creeps')
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');
const {creepIsFresh} = require('./behavior.commute');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const {MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_HARVEST_ROOM} = require('./constants.memory');
const {TOPIC_SPAWN, TOPIC_DEFENDERS} = require('./constants.topics');
const {WORKER_UPGRADER, WORKER_REPAIRER, WORKER_BUILDER, WORKER_DEFENDER} = require('./constants.creeps');
const {PRIORITY_UPGRADER, PRIORITY_BUILDER, PRIORITY_REPAIRER, PRIORITY_BOOTSTRAP,
  PRIORITY_REPAIRER_URGENT, PRIORITY_DEFENDER} = require('./constants.priorities');
const {WORKER_RESERVER, WORKER_DISTRIBUTOR, WORKER_HAULER} = require('./constants.creeps');
const {PRIORITY_RESERVER, PRIORITY_DISTRIBUTOR} = require('./constants.priorities');

const MIN_UPGRADERS = 1;
const MIN_DISTRIBUTORS = 1;
const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const MY_USERNAME = 'ENETDOWN';
const MIN_RESERVATION_TICKS = 4000;
const RESERVE_BUFFER = 200000;

const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 200;
const REQUEST_DEFENDERS_TTL = 75;
const REQUEST_DISTRIBUTOR_TTL = 100;
const REQUEST_RESERVER_TTL = 200;
const REQUEST_UPGRADER_TTL = 200;
const REQUEST_BUILDER_TTL = 200;
const REQUEST_REPAIRER_TTL = 200;

class Room extends OrgBase {
  constructor(parent, room, trace) {
    super(parent, room.name, trace);

    const setupTrace = this.trace.begin('constructor');

    this.roomObject = room; // preferred
    this.room = room;
    this.isPrimary = room.name === parent.primaryRoomId;
    this.claimedByMe = room.controller.my || false;
    this.reservedByMe = false;
    if (room.controller.reservation && room.controller.reservation.username === MY_USERNAME) {
      this.reservedByMe = true;
    }

    this.doRequestHaulDroppedResources = doEvery(REQUEST_HAUL_DROPPED_RESOURCES_TTL)(() => {
      this.droppedResourcesToHaul.forEach((resource) => {
        this.requestHaulDroppedResources(resource);
      });
    })

    this.doRequestDefenders = doEvery(REQUEST_DEFENDERS_TTL)(() => {
      this.requestDefender()
    })

    this.doRequestDistributor = doEvery(REQUEST_DISTRIBUTOR_TTL)(() => {
      this.requestDistributor()
    })

    this.doRequestReserver = doEvery(REQUEST_RESERVER_TTL)(() => {
      this.requestReserver()
    })

    this.doRequestReserverFromKingdom = doEvery(REQUEST_RESERVER_TTL)(() => {
      this.requestReserverFromKingdom()
    })

    this.doRequestUpgrader = doEvery(REQUEST_UPGRADER_TTL)((priority, energyLimit) => {
      this.requestUpgrader(priority, energyLimit)
    })
    this.doRequestUpgraderFromKingdom = doEvery(REQUEST_UPGRADER_TTL)((priority, energyLimit) => {
      this.requestUpgraderFromKingdom(priority, energyLimit)
    })

    this.doRequestBuilder = doEvery(REQUEST_BUILDER_TTL)(() => {
      this.requestBuilder()
    })
    this.doRequestBuilderFromKingdom = doEvery(REQUEST_BUILDER_TTL)(() => {
      this.requestBuilderFromKingdom()
    })

    this.doRequestRepairer = doEvery(REQUEST_REPAIRER_TTL)((priority) => {
      this.requestRepairer(priority);
    })

    setupTrace.end();
  }
  update() {
    const updateTrace = this.trace.begin('update');

    // was in constructor
    const roomPropsTrace = updateTrace.begin('room_props');

    const room = this.room;

    this.unowned = !this.room.controller.reservation && !this.room.controller.owner;
    // Construction sites will help decide how many builders we need
    this.numConstructionSites = this.room.find(FIND_CONSTRUCTION_SITES).length;
    this.myStructures = this.room.find(FIND_MY_STRUCTURES);
    this.roomStructures = this.room.find(FIND_STRUCTURES);

    this.hasStorage = this.getReserveStructures().filter((structure) => {
      return structure.structureType != STRUCTURE_SPAWN;
    }).length > 0;

    this.reservationTicks = 0;
    if (room.controller.reservation) {
      this.reservationTicks = room.controller.reservation.ticksToEnd;
    }

    roomPropsTrace.end();

    const creepPrepTrace = updateTrace.begin('creep_prep');

    this.roomCreeps = Object.values(Game.creeps).filter((creep) => {
      return creep.room.name === room.name;
    });

    const parent = this.parent;
    this.assignedCreeps = _.filter(parent.getCreeps(), (creep) => {
      return creep.memory[MEMORY_ASSIGN_ROOM] === room.name ||
        creep.memory[MEMORY_HARVEST_ROOM] === room.name;
    });

    this.numReservers = _.filter(this.assignedCreeps, (creep) => {
      const role = creep.memory[MEMORY_ROLE];
      return (role === WORKER_RESERVER) &&
        creep.memory[MEMORY_ASSIGN_ROOM] === room.name && creepIsFresh(creep);
    }).length;

    this.myDamagedCreeps = this.roomCreeps.filter((creep) => {
      return creep.hits < creep.hitsMax;
    });

    this.numRepairers = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_REPAIRER && creepIsFresh(creep);
    }).length;

    this.builders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_BUILDER && creepIsFresh(creep);
    });

    this.upgraders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKER_UPGRADER && creepIsFresh(creep);
    });

    this.distributors = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR &&
        creep.memory[MEMORY_ASSIGN_ROOM] === this.id && creepIsFresh(creep);
    });
    this.numDistributors = this.distributors.length;

    // We want to know if the room has hostiles, request defenders or put room in safe mode
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    // TODO order hostiles by priority
    this.hostiles = hostiles;
    this.numHostiles = this.hostiles.length;

    this.hasInvaderCore = this.roomStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_INVADER_CORE;
    }).length > 0;

    creepPrepTrace.end();

    const defenseTrace = updateTrace.begin('defenses');

    // We want to know if our defenses are being attacked
    this.lowHitsDefenses = this.roomStructures.filter((s) => {
      if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART) {
        return false;
      }

      return s.hits < 1000;
    }).length;

    let maxHits = 0;
    let hits = 0;
    let numStructures = 0;
    this.roomStructures.forEach((s) => {
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

    defenseTrace.end();

    const orgSetupTrace = updateTrace.begin('org_setup');

    const sources = [];
    const roomSources = room.find(FIND_SOURCES);
    roomSources.forEach((source) => {
      sources.push(new Source(this, source, 'energy', orgSetupTrace));
    });

    const minerals = this.getMineralsWithExtractor();
    minerals.forEach((mineral) => {
      if (mineral.mineralAmount > 0) {
        sources.push(new Source(this, mineral, 'mineral', orgSetupTrace));
      }
    });

    this.parkingLot = null;
    const parkingLots = room.find(FIND_FLAGS, {
      filter: (flag) => {
        return flag.name.startsWith('parking');
      },
    });

    if (parkingLots.length) {
      this.parkingLot = parkingLots[0];
    }

    this.sources = sources;

    this.links = this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_LINK;
    }).map((link) => {
      return new Link(this, link, orgSetupTrace);
    });

    // TODO build out org towers
    this.towers = this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_TOWER;
    }).map((tower) => {
      return new Tower(this, tower, orgSetupTrace);
    });

    this.terminal = null;
    if (room.terminal) {
      this.terminal = new Terminal(this, room.terminal, orgSetupTrace);
    }

    orgSetupTrace.end();

    const labsSetupTrace = updateTrace.begin('lab_setup');

    const [reactors, booster] = this.assignLabs(labsSetupTrace);
    this.reactors = reactors;
    this.booster = booster;

    labsSetupTrace.end();

    const droppedResourcesTrace = updateTrace.begin('dropped_resources');

    this.droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES, {
      filter: (resource) => {
        const isDispatched = _.filter(this.getColony().getHaulers(), (hauler) => {
          return hauler.memory[MEMORY.MEMORY_PICKUP] === resource.id;
        }).length > 0;

        return !isDispatched;
      },
    });

    droppedResourcesTrace.end();

    // was in constructor end

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
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestDefender();
        } else {
          this.doRequestDefenders();
        }
      }
    }

    let desiredDistributors = MIN_DISTRIBUTORS;
    if (this.roomObject.controller.level >= 3) {
      desiredDistributors = 2;
    }

    // Send a request if we are short on distributors
    if (this.hasStorage && this.numDistributors < desiredDistributors) {
      if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
        this.requestDistributor();
      } else {
        this.doRequestDistributor();
      }
    }

    // If not claimed by me and no claimer assigned and not primary, request a reserver
    if (!this.numReservers && ((!this.reservedByMe && !this.claimedByMe && !this.numHostiles) ||
      (this.reservedByMe && this.reservationTicks < MIN_RESERVATION_TICKS))) {
      if (this.getColony().spawns.length) {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestReserver();
        } else {
          this.doRequestReserver();
        }
      } else {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestReserverFromKingdom();
        } else {
          this.doRequestReserverFromKingdom()
        }
      }
    }

    if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
      this.droppedResourcesToHaul.forEach((resource) => {
        this.requestHaulDroppedResources(resource);
      });
    } else {
      this.doRequestHaulDroppedResources();
    }

    // Upgrader request
    const desiredUpgraders = this.getDesiredUpgraders();
    if (this.isPrimary && this.upgraders.length < desiredUpgraders) {
      // As we get more upgraders, lower the priority
      const upgraderPriority = PRIORITY_UPGRADER - (this.upgraders.length * 2);

      let energyLimit = 500;
      const reserveEnergy = this.getAmountInReserve(RESOURCE_ENERGY);
      if (reserveEnergy > RESERVE_BUFFER) {
        // Determine energy limit by the amount of energy above the dedicated buffer
        energyLimit = (reserveEnergy - RESERVE_BUFFER) / 1500 * 200;
        if (energyLimit < 300) {
          energyLimit = 300;
        }
      }

      // TODO this will need to be expanded to support
      // multiple claims

      if (this.getColony().spawns.length) {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestUpgrader(upgraderPriority, energyLimit);
        } else {
          this.doRequestUpgrader(upgraderPriority, energyLimit)
        }
      } else {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestUpgraderFromKingdom(PRIORITY_BOOTSTRAP + upgraderPriority, energyLimit);
        } else {
          this.doRequestUpgraderFromKingdom(PRIORITY_BOOTSTRAP + upgraderPriority, energyLimit)
        }
      }
    }

    // Builder requests
    if (this.builders.length < Math.ceil(this.numConstructionSites / 15)) {
      if (this.getColony().spawns.length) {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestBuilder();
        } else {
          this.doRequestBuilder();
        }
      } else {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestBuilderFromKingdom();
        } else {
          this.doRequestBuilderFromKingdom();
        }
      }
    }

    if (!this.numHostiles && !this.hasInvaderCore) {
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
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestRepairer(repairerPriority);
        } else {
          this.doRequestRepairer(repairerPriority);
        }
      }
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

    if (this.reactors && this.reactors.length) {
      this.reactors.forEach((reactor) => {
        reactor.update();
      });
    }

    if (this.booster) {
      this.booster.update()
    }

    updateTrace.end();
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

    if (this.reactors && this.reactors.length) {
      this.reactors.forEach((reactor) => {
        reactor.process();
      });
    }

    if (this.booster) {
      this.booster.process()
    }
  }
  toString() {
    return `-- Room - ID: ${this.id}, Primary: ${this.isPrimary}, Claimed: ${this.claimedByMe}, ` +
      `Reservers: ${this.numReservers}, #Builders: ${this.builders.length}, ` +
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
  getRoomCreeps() {
    return this.roomCreeps;
  }
  getSpawns() {
    return this.roomObject.find(FIND_MY_SPAWNS);
  }
  getHostiles() {
    return this.hostiles;
  }
  getLabs() {
    return this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_LAB;
    });
  }
  assignLabs(trace) {
    const reactors = [];
    let booster = null;

    // Get list of labs in rooms
    let labs = this.getLabs();

    // Find lab closest to spawn
    const spawns = this.getSpawns();
    if (!spawns.length) {
      return [reactors, booster];
    }

    let boosterLabs = [];
    const primaryBooster = _.sortBy(spawns[0].pos.findInRange(labs, 2), 'id').shift();
    if (primaryBooster) {
      boosterLabs = _.sortBy(primaryBooster.pos.findInRange(labs, 1), 'id');
      booster = new Booster(this, boosterLabs, trace);
    }

    // Subtract booster labs from list
    labs = labs.filter((lab) => {
      return _.findIndex(boosterLabs, {id: lab.id}) === -1;
    });

    if (this.roomObject.storage) {
      // While we have at least 3 labs, create a reactor
      while (labs.length >= 3) {
        // Find labs within 3 of spawns and make booster
        let reactorLabs = [];
        const primaryReactor = _.sortBy(this.roomObject.storage.pos.findInRange(labs, 3), 'id').shift();
        if (!primaryReactor) {
          break;
        }

        reactorLabs = _.sortBy(primaryReactor.pos.findInRange(labs, 1), 'id');
        if (reactorLabs.length >= 3) {
          reactorLabs = reactorLabs.slice(0, 3);
          // Make reactor
          reactors.push(new Reactor(this, reactorLabs, trace));
        }

        // Subtract reactor labs from list
        labs = labs.filter((lab) => {
          return _.findIndex(reactorLabs, {id: lab.id}) === -1;
        });
      }
    }

    return [reactors, booster];
  }
  getDesiredUpgraders() {
    let desiredUpgraders = 0;

    if (!this.roomObject.controller.my) {
      desiredUpgraders = 0;
    } else if (this.roomObject.controller.level === 8) {
      desiredUpgraders = 0;
    } else if (this.roomObject.controller.level >= 5) {
      desiredUpgraders = 1;
    } else if (!this.hasStorage) {
      desiredUpgraders = 1;
    } else {
      const fullness = this.getEnergyFullness();
      desiredUpgraders = Math.ceil(fullness / 0.33);
      if (desiredUpgraders < MIN_UPGRADERS) {
        desiredUpgraders = MIN_UPGRADERS;
      }
    }

    return desiredUpgraders;
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
  getReserveStructures(includeTerminal = false) {
    const reserveStructures = [];

    if (this.roomObject.storage) {
      reserveStructures.push(this.roomObject.storage);
    }

    if (includeTerminal && this.roomObject.terminal) {
      reserveStructures.push(this.roomObject.terminal);
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
          if (structure.structureType !== STRUCTURE_CONTAINER &&
            structure.structureType !== STRUCTURE_SPAWN) {
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
  getAmountInReserve(resource) {
    return this.getReserveResources()[resource] || 0;
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
    let list = this.roomObject.memory[MEMORY.ROOM_NEEDS_ENERGY_LIST] || [];
    let listTime = this.roomObject.memory[MEMORY.ROOM_NEEDS_ENERGY_TIME] || Game.time;

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

      list = this.myStructures.filter((structure) => {
        return ( // Fill extensions and spawns with room
          (structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_SPAWN ||
            (
              structure.structureType == STRUCTURE_LINK &&
              room.storage && structure.pos.inRangeTo(room.storage, 2)
            )
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

    this.roomObject.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_LIST] = list;
    this.roomObject.memory[MEMORY.ROOM_DAMAGED_STRUCTURES_TIME] = listTime;

    if (!next) {
      return null;
    }

    return Game.getObjectById(next);
  }
  getParkingLot() {
    return this.parkingLot;
  }
  getTerminal() {
    return this.terminal;
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
  requestDefender() {
    this.sendRequest(TOPICS.TOPIC_DEFENDERS, PRIORITIES.PRIORITY_DEFENDER, {
      role: CREEPS.WORKER_DEFENDER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      },
    });
  }
  requestDistributor() {
    let distributorPriority = PRIORITY_DISTRIBUTOR;
    if (this.getAmountInReserve(RESOURCE_ENERGY) === 0) {
      distributorPriority = PRIORITIES.DISTRIBUTOR_NO_RESERVE;
    }

    this.sendRequest(TOPICS.TOPIC_SPAWN, distributorPriority, {
      role: CREEPS.WORKER_DISTRIBUTOR,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      },
    });
  }
  requestReserver() {
    this.sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_RESERVER, {
      role: CREEPS.WORKER_RESERVER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      },
    });
  }
  requestReserverFromKingdom() {
    this.getKingdom().sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_RESERVER + 1, {
      role: CREEPS.WORKER_RESERVER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.getColony().id,
      },
    });
  }
  requestHaulDroppedResources(resource) {
    const loadPriority = 0.8;
    const details = {
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: resource.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource.resourceType,
    };

    console.log("dropped resources", loadPriority, resource.amount, JSON.stringify(details))

    this.sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details);
  }
  requestUpgrader(priority, energyLimit) {
    this.sendRequest(TOPIC_SPAWN, priority, {
      role: WORKER_UPGRADER,
      energyLimit: energyLimit,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
      },
    });
  }
  requestUpgradersFromKingdom(priority, energyLimit) {
    this.getKingdom().sendRequest(TOPIC_SPAWN, priority, {
      role: WORKER_UPGRADER,
      energyLimit: energyLimit,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.getColony().id,
      },
    });
  }
  requestBuilder() {
    this.sendRequest(TOPIC_SPAWN, PRIORITY_BUILDER - (this.builders.length * 2), {
      role: WORKER_BUILDER,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
      },
    });
  }
  requestBuilderFromKingdom() {
    this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_BOOTSTRAP + PRIORITY_BUILDER - this.builders.length, {
      role: WORKER_BUILDER,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.getColony().id,
      },
    });
  }
  requestRepairer(priority) {
    this.sendRequest(TOPIC_SPAWN, priority, {
      role: WORKER_REPAIRER,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
      },
    });
  }
}

module.exports = Room;
