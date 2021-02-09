
const OrgBase = require('./org.base');
const Link = require('./org.link');
const Tower = require('./org.tower');
const Terminal = require('./org.terminal');
const Source = require('./org.source');
const Booster = require('./org.booster');
const Reactor = require('./org.reactor');
const Spawner = require('./org.spawner');

const CREEPS = require('./constants.creeps')
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');
const {creepIsFresh} = require('./behavior.commute');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const {MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_HARVEST_ROOM} = require('./constants.memory');
const {TOPIC_SPAWN} = require('./constants.topics');
const {WORKER_UPGRADER, WORKER_REPAIRER, WORKER_BUILDER} = require('./constants.creeps');
const {PRIORITY_UPGRADER, PRIORITY_BUILDER, PRIORITY_REPAIRER,
  PRIORITY_REPAIRER_URGENT} = require('./constants.priorities');
const {WORKER_RESERVER, WORKER_DISTRIBUTOR, WORKER_HAULER} = require('./constants.creeps');
const {PRIORITY_DISTRIBUTOR} = require('./constants.priorities');

const MIN_UPGRADERS = 1;
const MIN_DISTRIBUTORS = 1;
const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const MY_USERNAME = 'ENETDOWN';
const MIN_RESERVATION_TICKS = 4000;
const RESERVE_BUFFER = 200000;

const UPDATE_CREEPS_TTL = 1;
const UPDATE_ORG_TTL = 1;
const UPDATE_DEFENSE_STATUS_TTL = 20;

const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 200;
const REQUEST_DEFENDERS_TTL = 20;
const REQUEST_DISTRIBUTOR_TTL = 25;
const REQUEST_RESERVER_TTL = 50;
const REQUEST_UPGRADER_TTL = 25;
const REQUEST_BUILDER_TTL = 50;
const REQUEST_REPAIRER_TTL = 50;

class Room extends OrgBase {
  constructor(parent, room, trace) {
    super(parent, room.name, trace);

    const setupTrace = this.trace.begin('constructor');

    this.room = room;
    this.isPrimary = room.name === parent.primaryRoomId;

    this.linkMap = {};
    this.towerMap = {};
    this.sourceMap = {};
    this.reactorMap = {};
    this.booster = null;
    this.terminal = null;
    this.parkingLot = null;

    // Creeps
    this.roomCreeps = [];
    this.assignedCreeps = [];
    this.numReservers = 0;
    this.numRepairers = 0;
    this.builders = [];
    this.doUpdateCreeps = doEvery(UPDATE_CREEPS_TTL)((trace) => {
      this.updateCreeps(trace);
    });

    // Organization
    this.spawnMap = {};
    this.hasSpawns = false;
    this.doUpdateOrg = doEvery(UPDATE_ORG_TTL)((trace) => {
      this.updateOrg(trace)
    });

    // Defense status
    this.hostiles = [];
    this.numHostiles = 0;
    this.hasInvaderCore = false;
    this.hitsPercentage = 0.0;
    this.numStructures = 0;
    this.doUpdateDefenseStatus = doEvery(UPDATE_DEFENSE_STATUS_TTL)((trace) => {
      this.updateDefenseStatus(trace)
    });

    // Request things
    this.doRequestHaulDroppedResources = doEvery(REQUEST_HAUL_DROPPED_RESOURCES_TTL)(() => {
      this.requestHaulDroppedResources();
    });

    this.doRequestDefenders = doEvery(REQUEST_DEFENDERS_TTL)(() => {
      this.requestDefender();
    });

    this.doRequestDistributor = doEvery(REQUEST_DISTRIBUTOR_TTL)(() => {
      this.requestDistributor();
    });

    this.doRequestReserver = doEvery(REQUEST_RESERVER_TTL)(() => {
      this.requestReserver();
    });

    this.doRequestUpgrader = doEvery(REQUEST_UPGRADER_TTL)(() => {
      this.requestUpgrader();
    });

    this.doRequestBuilder = doEvery(REQUEST_BUILDER_TTL)(() => {
      this.requestBuilder();
    });

    this.doRequestRepairer = doEvery(REQUEST_REPAIRER_TTL)(() => {
      this.requestRepairer();
    });

    setupTrace.end();
  }
  update() {
    const updateTrace = this.trace.begin('update');

    const room = this.room = Game.rooms[this.id];
    if (!room) {
      console.log("XXXXXXXX cannot find room", this.id);
      return;
    }

    // was in constructor
    const roomPropsTrace = updateTrace.begin('room_props');

    this.claimedByMe = room.controller.my || false;
    this.reservedByMe = false;
    if (room.controller.reservation && room.controller.reservation.username === MY_USERNAME) {
      this.reservedByMe = true;
    }

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

    this.availableSpawns = Object.values(this.spawnMap).filter((spawner) => {
      return !spawner.getSpawning();
    });

    roomPropsTrace.end();

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.updateCreeps(updateTrace);
    } else {
      this.doUpdateCreeps(updateTrace);
    }

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.updateDefenseStatus(updateTrace);
    } else {
      this.doUpdateDefenseStatus(updateTrace);
    }

    const droppedResourcesTrace = updateTrace.begin('dropped_resources');

    this.droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES, {
      filter: (resource) => {
        const numAssigned = _.filter(this.getColony().getHaulers(), (hauler) => {
          return hauler.memory[MEMORY.MEMORY_HAUL_PICKUP] === resource.id;
        }).length;

        //console.log("... dropped assigned", resource.id, numAssigned, resource.resourceType, resource.amount)

        return numAssigned === 0;
      },
    });

    droppedResourcesTrace.end();

    // was in constructor end

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.updateOrg(updateTrace)
    } else {
      this.doUpdateOrg(updateTrace)
    }

    const requestTrace = updateTrace.begin('requests');

    // Request defenders
    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestDefender();
    } else {
      this.doRequestDefenders();
    }

    // Send a request if we are short on distributors
    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestDistributor();
    } else {
      this.doRequestDistributor();
    }

    // If not claimed by me and no claimer assigned and not primary, request a reserver
    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestReserver();
    } else {
      this.doRequestReserver();
    }

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestHaulDroppedResources();
    } else {
      this.doRequestHaulDroppedResources();
    }

    // Upgrader request
    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestUpgrader();
    } else {
      this.doRequestUpgrader()
    }

    // Builder requests
    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestBuilder();
    } else {
      this.doRequestBuilder();
    }

    if (!featureFlags.getFlag(featureFlags.PERSISTENT_TOPICS)) {
      this.requestRepairer();
    } else {
      this.doRequestRepairer();
    }

    console.log(this);

    requestTrace.end();

    const sourcesTrace = updateTrace.begin('sources');
    Object.values(this.sourceMap).forEach((source) => {
      source.update(sourcesTrace);
    });
    sourcesTrace.end();

    const linksTrace = updateTrace.begin('links');
    Object.values(this.linkMap).forEach((link) => {
      link.update(linksTrace);
    });
    linksTrace.end();

    const towersTrace = updateTrace.begin('towers');
    Object.values(this.towerMap).forEach((tower) => {
      tower.update(towersTrace);
    });
    towersTrace.end();

    const spawnsTrace = updateTrace.begin('spawns');
    Object.values(this.spawnMap).forEach((spawn) => {
      spawn.update(spawnsTrace);
    });
    spawnsTrace.end();

    const reactorsTrace = updateTrace.begin('reactor');
    Object.values(this.reactorMap).forEach((reactor) => {
      reactor.update(reactorsTrace);
    });
    reactorsTrace.end();

    if (this.booster) {
      const boosterTrace = updateTrace.begin('booster');
      this.booster.update(boosterTrace)
      boosterTrace.end();
    }

    if (this.terminal) {
      const terminalTrace = updateTrace.begin('terminal');
      this.terminal.update(terminalTrace);
      terminalTrace.end();
    }

    updateTrace.end();
  }
  process() {
    if (!this.room) {
      return;
    }

    this.updateStats();

    Object.values(this.sourceMap).forEach((source) => {
      source.process();
    });

    Object.values(this.linkMap).forEach((link) => {
      link.process();
    });

    Object.values(this.towerMap).forEach((tower) => {
      tower.process();
    });

    Object.values(this.spawnMap).forEach((spawn) => {
      spawn.process();
    });

    Object.values(this.reactorMap).forEach((reactor) => {
      reactor.process();
    });

    if (this.booster) {
      this.booster.process()
    }

    if (this.terminal) {
      this.terminal.process();
    }
  }
  toString() {
    return `-- Room - ID: ${this.id}, Primary: ${this.isPrimary}, Claimed: ${this.claimedByMe}, ` +
      `Reservers: ${this.numReservers}, #Builders: ${this.builders.length}, ` +
      `#Hostiles: ${this.numHostiles}, ` +
      `#Spawners: ${Object.keys(this.spawnMap).length}, ` +
      `#AvailableSpawners: ${this.availableSpawns.length}, ` +
      `#Towers: ${Object.keys(this.towerMap).length}, #Sites: ${this.numConstructionSites}, ` +
      `%Hits: ${this.hitsPercentage.toFixed(2)}, #Repairer: ${this.numRepairers}, ` +
      `#Links: ${Object.keys(this.linkMap).length}, ` +
      `EnergyFullness: ${this.getEnergyFullness()}`;
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
  getRoomCreeps() {
    return this.roomCreeps;
  }
  getSpawns() {
    return this.room.find(FIND_MY_SPAWNS);
  }
  getHostiles() {
    return this.hostiles;
  }
  getBooster() {
    return this.booster;
  }
  getLabs() {
    return this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_LAB;
    });
  }
  updateLabs(trace) {
    const labsSetupTrace = trace.begin('lab_setup');

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

    if (this.room.storage) {
      // While we have at least 3 labs, create a reactor
      while (labs.length >= 3) {
        // Find labs within 3 of spawns and make booster
        let reactorLabs = [];
        const primaryReactor = _.sortBy(this.room.storage.pos.findInRange(labs, 3), 'id').shift();
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

    // Update the reactor map (add missing items and remove extra items)
    const reactorIds = _.pluck(reactors, 'id')
    const reactorMap = _.indexBy(reactors, 'id')
    const orgIds = Object.keys(this.reactorMap)

    const missingReactorIds = _.difference(reactorIds, orgIds)
    missingReactorIds.forEach((id) => {
      this.reactorMap[id] = reactorMap[id];
    })

    const extraReactorIds = _.difference(orgIds, reactorIds)
    extraReactorIds.forEach((id) => {
      delete this.reactorMap[id]
    })

    if ((!this.booster && booster) || (this.booster && booster && this.booster.id !== booster.id)) {
      this.booster = booster
    } else if (!booster) {
      this.booster = null;
    }

    labsSetupTrace.end();
  }
  getDesiredUpgraders() {
    let desiredUpgraders = 0;

    if (!this.room.controller.my) {
      desiredUpgraders = 0;
    } else if (this.room.controller.level === 8) {
      desiredUpgraders = 0;
    } else if (this.room.controller.level >= 5) {
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

    const stats = this.getStats();
    stats.colonies[this.getColony().id].rooms[this.id] = roomStats;
  }
  requestDefender() {
    const controller = this.room.controller;

    // If hostiles present spawn defenders and/or activate safe mode
    if (this.numHostiles || this.hasInvaderCore) {
      // If there are defenses low on
      if (controller && controller.my && this.lowHitsDefenses && controller.safeModeAvailable &&
        !controller.safeMode && !controller.safeModeCooldown) {
        console.log('ACTIVATING SAFEMODE!!!!!');
        controller.activateSafeMode();
      } else if (!controller.safeMode || controller.safeModeCooldown < 250) {
        // Request defenders
        this.sendRequest(TOPICS.TOPIC_DEFENDERS, PRIORITIES.PRIORITY_DEFENDER, {
          role: CREEPS.WORKER_DEFENDER,
          memory: {
            [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
          },
        }, REQUEST_DEFENDERS_TTL);
      }
    }
  }
  requestDistributor() {
    const numDistributors = _.filter(this.getCreeps(), (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR &&
        creep.memory[MEMORY_ASSIGN_ROOM] === this.id && creepIsFresh(creep);
    }).length;

    let desiredDistributors = MIN_DISTRIBUTORS;
    if (this.room.controller.level >= 3) {
      desiredDistributors = 2;
    }

    if (!this.hasStorage || numDistributors >= desiredDistributors) {
      return;
    }

    let distributorPriority = PRIORITY_DISTRIBUTOR;
    if (this.getAmountInReserve(RESOURCE_ENERGY) === 0) {
      distributorPriority = PRIORITIES.DISTRIBUTOR_NO_RESERVE;
    }

    if (this.getAmountInReserve(RESOURCE_ENERGY) > 25000) {
      distributorPriority += 3;
    }

    this.requestSpawn(distributorPriority, {
      role: CREEPS.WORKER_DISTRIBUTOR,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.getColony().id,
      },
    }, REQUEST_DISTRIBUTOR_TTL);
  }
  requestReserver() {
    if (!this.numReservers && ((!this.reservedByMe && !this.claimedByMe && !this.numHostiles) ||
      (this.reservedByMe && this.reservationTicks < MIN_RESERVATION_TICKS))) {
      this.requestSpawn(PRIORITIES.PRIORITY_RESERVER, {
        role: CREEPS.WORKER_RESERVER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
          [MEMORY.MEMORY_COLONY]: this.getColony().id,
        },
      }, REQUEST_RESERVER_TTL);
    }
  }
  requestUpgrader() {
    const numUpgraders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKER_UPGRADER && creepIsFresh(creep);
    }).length;

    const desiredUpgraders = this.getDesiredUpgraders();
    if (this.isPrimary && numUpgraders < desiredUpgraders) {
      // As we get more upgraders, lower the priority
      const upgraderPriority = PRIORITY_UPGRADER - (numUpgraders * 2);

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

      this.requestSpawn(upgraderPriority, {
        role: WORKER_UPGRADER,
        energyLimit: energyLimit,
        memory: {
          [MEMORY_ASSIGN_ROOM]: this.id,
          [MEMORY.MEMORY_COLONY]: this.getColony().id,
        },
      }, REQUEST_UPGRADER_TTL);
    }
  }
  requestBuilder() {
    if (this.builders.length >= Math.ceil(this.numConstructionSites / 10)) {
      return;
    }

    this.requestSpawn(PRIORITY_BUILDER - (this.builders.length * 2), {
      role: WORKER_BUILDER,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.getColony().id,
      },
    }, REQUEST_BUILDER_TTL);
  }
  requestRepairer() {
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

    if (this.numRepairers >= desiredRepairers) {
      return;
    }

    this.requestSpawn(repairerPriority, {
      role: WORKER_REPAIRER,
      memory: {
        [MEMORY_ASSIGN_ROOM]: this.id,
      },
    }, REQUEST_REPAIRER_TTL);
  }
  requestSpawn(priority, details, ttl) {
    if (this.hasSpawns) {
      this.sendRequest(TOPIC_SPAWN, priority, details, ttl);
    } else {
      this.getKingdom().sendRequest(TOPIC_SPAWN, priority, details, ttl);
    }
  }
  requestHaulDroppedResources() {
    this.droppedResourcesToHaul.forEach((resource) => {
      const loadPriority = 0.8;
      const details = {
        [MEMORY.TASK_ID]: `pickup-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: resource.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: resource.resourceType,
      };

      //console.log("dropped resources", loadPriority, resource.amount, JSON.stringify(details))

      this.sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details);
    }, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
  }
  updateOrg(trace) {
    const orgSetupTrace = trace.begin('org_setup');

    const room = this.room;

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

    // Links
    const roomLinks = this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_LINK;
    })
    this.linkMap = this.updateOrgMap(roomLinks, 'id', this.linkMap, Link, orgSetupTrace)

    // Towers
    const roomTowers = this.myStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_TOWER;
    })
    this.towerMap = this.updateOrgMap(roomTowers, 'id', this.towerMap, Tower, orgSetupTrace)

    // Sources and Minerals
    let roomSources = room.find(FIND_SOURCES);
    roomSources = roomSources.concat(this.getMineralsWithExtractor())
    //console.log("xxxxx room sources", roomSources)
    this.sourceMap = this.updateOrgMap(roomSources, 'id', this.sourceMap, Source, orgSetupTrace)


    // Spawns
    const roomSpawns = this.getSpawns()
    const spawnIds = _.pluck(roomSpawns, 'id')
    const spawnMap = _.indexBy(roomSpawns, 'id')
    const orgIds = Object.keys(this.spawnMap)

    const missingOrgSpawnIds = _.difference(spawnIds, orgIds)
    missingOrgSpawnIds.forEach((id) => {
      const orgNode = new Spawner(this, spawnMap[id], trace)
      this.spawnMap[id] = orgNode;
    })

    const extraOrgSpawnIds = _.difference(orgIds, spawnIds)
    extraOrgSpawnIds.forEach((id) => {
      delete this.spawnMap[id]
    })

    this.hasSpawns = Object.keys(this.spawnMap).length > 0;

    // Booster and Reactors
    this.updateLabs(orgSetupTrace);

    // Terminal
    if ((!this.terminal && room.terminal) || (this.terminal && this.terminal.id !== room.terminal.id)) {
      this.terminal = new Terminal(this, room.terminal, orgSetupTrace);
    } else if (!room.terminal) {
      this.terminal = null;
    }

    orgSetupTrace.end();
  }
  updateOrgMap(roomStructures, keyName, orgMap, constructor, trace) {
    const roomIds = _.pluck(roomStructures, keyName)
    const orgIds = Object.keys(orgMap)

    const missingOrgIds = _.difference(roomIds, orgIds)
    missingOrgIds.forEach((id) => {
      const orgNode = new constructor(this, Game.getObjectById(id), trace)
      orgMap[id] = orgNode;
    })

    const extraOrgIds = _.difference(orgIds, roomIds)
    extraOrgIds.forEach((id) => {
      delete orgMap[id]
    })

    return orgMap;
  }
  updateCreeps(trace) {
    const creepPrepTrace = trace.begin('creep_prep');

    this.roomCreeps = Object.values(Game.creeps).filter((creep) => {
      return creep.room.name === this.room.name;
    });

    this.assignedCreeps = _.filter(this.getParent().getCreeps(), (creep) => {
      return creep.memory[MEMORY_ASSIGN_ROOM] === this.room.name ||
        creep.memory[MEMORY_HARVEST_ROOM] === this.room.name;
    });

    this.numReservers = _.filter(this.assignedCreeps, (creep) => {
      const role = creep.memory[MEMORY_ROLE];
      return (role === WORKER_RESERVER) &&
        creep.memory[MEMORY_ASSIGN_ROOM] === this.room.name && creepIsFresh(creep);
    }).length;

    this.numRepairers = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_REPAIRER && creepIsFresh(creep);
    }).length;

    this.builders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] === WORKER_BUILDER && creepIsFresh(creep);
    });

    creepPrepTrace.end();
  }
  updateDefenseStatus(trace) {
    const defenseTrace = trace.begin('defenses');

    // We want to know if the room has hostiles, request defenders or put room in safe mode
    const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
    // TODO order hostiles by priority
    this.hostiles = hostiles;
    this.numHostiles = this.hostiles.length;

    this.hasInvaderCore = this.roomStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_INVADER_CORE;
    }).length > 0;

    this.myDamagedCreeps = this.roomCreeps.filter((creep) => {
      return creep.hits < creep.hitsMax;
    });

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
  }
}

module.exports = Room;
