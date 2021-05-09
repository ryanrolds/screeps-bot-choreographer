import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {doEvery} from './lib.scheduler';

import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";

import {Priorities, Scheduler} from "./os.scheduler";

import LinkManager from "./runnable.manager.links"
import TowerRunnable from "./runnable.tower"
import SourceRunnable from "./runnable.source";
import SpawnManager from "./runnable.manager.spawns";
import TerminalRunnable from "./runnable.terminal";
import {LabsManager} from "./runnable.manager.labs";
import {creepIsFresh} from './behavior.commute';

import PRIORITIES from './constants.priorities';
import MEMORY from './constants.memory';
import CREEPS from './constants.creeps';
import TOPICS from './constants.topics';
import TASKS from './constants.tasks';

const MIN_ENERGY = 10000;
const ENERGY_REQUEST_TTL = 50;
const UPGRADER_ENERGY = 25000;
const REQUEST_REPAIRER_TTL = 50;
const REQUEST_BUILDER_TTL = 50;
const MIN_DISTRIBUTORS = 1;
const REQUEST_DISTRIBUTOR_TTL = 25;
const MIN_RESERVATION_TICKS = 4000;
const REQUEST_RESERVER_TTL = 5;
const MIN_UPGRADERS = 1;
const MAX_UPGRADERS = 5;
const REQUEST_UPGRADER_TTL = 25;
const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 15;

export default class RoomRunnable {
  id: string;
  scheduler: Scheduler;
  requestEnergyTTL: number;
  prevTime: number;
  doRequestRepairer: any;
  doRequestBuilder: any;
  doRequestDistributor: any;
  doRequestReserver: any;
  doRequestUpgrader: any;
  doRequestHaulDroppedResources: any;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.requestEnergyTTL = ENERGY_REQUEST_TTL;
    this.prevTime = Game.time;

    // Tasks
    this.doRequestRepairer = doEvery(REQUEST_REPAIRER_TTL, null, null)(this.requestRepairer.bind(this));
    this.doRequestBuilder = doEvery(REQUEST_BUILDER_TTL, null, null)(this.requestBuilder.bind(this));
    this.doRequestDistributor = doEvery(REQUEST_DISTRIBUTOR_TTL, null, null)(this.requestDistributor.bind(this));
    this.doRequestReserver = doEvery(REQUEST_RESERVER_TTL, null, null)(this.requestReserver.bind(this));
    this.doRequestUpgrader = doEvery(REQUEST_UPGRADER_TTL, null, null)(this.requestUpgrader.bind(this));
    this.doRequestHaulDroppedResources = doEvery(REQUEST_HAUL_DROPPED_RESOURCES_TTL, null, null)(this.requestHaulDroppedResources.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.requestEnergyTTL -= ticks;

    trace.log('room run', {
      id: this.id,
    });

    const orgRoom = kingdom.getRoomByName(this.id);
    // TODO implement room class
    if (!orgRoom) {
      return terminate();
    }

    const room = Game.rooms[this.id];
    if (!room) {
      trace.log('cannot find room in game', {});
      return terminate();
    }

    trace.log('room run', {});

    if (!orgRoom.isPrimary) {
      this.doRequestReserver(kingdom, orgRoom, room, trace);
    }

    if (orgRoom.isPrimary) {
      // Send a request if we are short on distributors
      this.doRequestDistributor(orgRoom, room, trace);
      // Upgrader request
      this.doRequestUpgrader(orgRoom, room, trace);
    }

    if (room.controller?.my || !room.controller?.owner?.username) {
      // Sources
      room.find<FIND_SOURCES>(FIND_SOURCES).forEach((source) => {
        const sourceId = `${source.id}`
        if (!this.scheduler.hasProcess(sourceId)) {
          this.scheduler.registerProcess(new Process(sourceId, 'sources', Priorities.RESOURCES,
            new SourceRunnable(orgRoom, source)));
        }
      });

      // Mineral
      const mineral = orgRoom.roomStructures.filter((structure) => {
        return structure.structureType === STRUCTURE_EXTRACTOR;
      }).map((extractor) => {
        const minerals = extractor.pos.findInRange(FIND_MINERALS, 0);
        return minerals[0];
      })[0];
      if (mineral) {
        const mineralId = `${mineral.id}`
        if (!this.scheduler.hasProcess(mineralId)) {
          this.scheduler.registerProcess(new Process(mineralId, 'mineral', Priorities.RESOURCES,
            new SourceRunnable(orgRoom, mineral)));
        }
      }

      // TODO don't request builders or repairers
      this.doRequestBuilder(orgRoom, room, trace);
      this.doRequestRepairer(orgRoom, room, trace);
    }

    if (orgRoom.isPrimary) {
      // Spawn Manager
      const spawnManagerId = `spawns_${this.id}`
      if (!this.scheduler.hasProcess(spawnManagerId)) {
        this.scheduler.registerProcess(new Process(spawnManagerId, 'spawns', Priorities.DEFENCE,
          new SpawnManager(spawnManagerId, orgRoom)));
      }

      // Towers
      room.find<StructureTower>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_TOWER,
      }).forEach((tower) => {
        const towerId = `${tower.id}`
        if (!this.scheduler.hasProcess(towerId)) {
          this.scheduler.registerProcess(new Process(towerId, 'towers', Priorities.DEFENCE,
            new TowerRunnable(orgRoom, tower)));
        }
      });

      // Link Manager
      const linkManagerId = `links_${this.id}`
      if (!this.scheduler.hasProcess(linkManagerId)) {
        this.scheduler.registerProcess(new Process(linkManagerId, 'links', Priorities.LOGISTICS,
          new LinkManager(linkManagerId, orgRoom)));
      }

      // Labs Manager
      const labsManagerId = `labs_${this.id}`;
      if (!this.scheduler.hasProcess(labsManagerId)) {
        this.scheduler.registerProcess(new Process(labsManagerId, 'labs', Priorities.LOGISTICS,
          new LabsManager(labsManagerId, orgRoom, this.scheduler, trace)));
      }


      if (room.terminal) {
        // Terminal runnable
        const terminalId = room.terminal.id;
        if (!this.scheduler.hasProcess(terminalId)) {
          this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.LOGISTICS,
            new TerminalRunnable(orgRoom, room.terminal)));
        }

        const terminalEnergy = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
        const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

        trace.log('room energy', {
          requestEnergyTTL: this.requestEnergyTTL,
          terminalEnergy,
          storageEnergy,
          roomLevel: orgRoom.getRoomLevel(),
          desiredBuffere: orgRoom.getReserveBuffer(),
        });

        let requestEnergy = false;

        // if we are below minimum energy, request more
        if (storageEnergy + terminalEnergy < MIN_ENERGY && this.requestEnergyTTL < 0) {
          requestEnergy = true;
        }

        // If not level 8, request more energy then buffer for upgrades
        if (orgRoom.getRoomLevel() < 8 && storageEnergy < orgRoom.getReserveBuffer() + UPGRADER_ENERGY) {
          requestEnergy = true;
        }

        if (requestEnergy) {
          this.requestEnergyTTL = ENERGY_REQUEST_TTL;
          const amount = 5000;
          trace.log('requesting energy from governor', {amount, resource: RESOURCE_ENERGY});
          (orgRoom as any).getKingdom().getResourceGovernor().requestResource(orgRoom,
            RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
        }
      }

      // Observer runnable
    }

    return sleeping(10);
  }

  requestRepairer(orgRoom: OrgRoom, room: Room, trace: Tracer) {
    let maxHits = 0;
    let hits = 0;

    const roomStructures = room.find(FIND_STRUCTURES);
    roomStructures.forEach((s) => {
      if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
        return;
      }

      if (s.hitsMax > 0 && s.hits > 0) {
        maxHits += s.hitsMax;
        hits += s.hits;
      }
    });

    let hitsPercentage = 1;
    if (maxHits > 0) {
      hitsPercentage = hits / maxHits;
    }

    const numRepairers = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_REPAIRER && creepIsFresh(creep);
    }).length;

    // Repairer requests
    let desiredRepairers = 0;
    let repairerPriority = PRIORITIES.PRIORITY_REPAIRER;
    if (hitsPercentage < 0.8) {
      desiredRepairers = 1;
    }

    if (hitsPercentage < 0.6) {
      desiredRepairers = 2;
      repairerPriority = PRIORITIES.PRIORITY_REPAIRER_URGENT;
    }

    if (numRepairers >= desiredRepairers) {
      return;
    }

    (orgRoom as any).requestSpawn(repairerPriority, {
      role: CREEPS.WORKER_REPAIRER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      },
    }, REQUEST_REPAIRER_TTL);
  }

  requestBuilder(orgRoom: OrgRoom, room: Room, trace: Tracer) {
    if (!Object.values(Game.spawns).length) {
      // We have no spawns in this shard
      return;
    }

    const builders = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_BUILDER && creepIsFresh(creep);
    });

    const numConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;

    let desiredBuilders = 0;
    if ((orgRoom.isPrimary && orgRoom.claimedByMe && room.controller.level <= 2) ||
      (orgRoom.reservedByMe && numConstructionSites)) {
      desiredBuilders = 3;
    } else if (room.controller.level > 2) {
      desiredBuilders = Math.ceil(numConstructionSites / 10);
    }

    if (builders.length >= desiredBuilders) {
      return;
    }

    (orgRoom as any).requestSpawn(PRIORITIES.PRIORITY_BUILDER - (builders.length * 2), {
      role: CREEPS.WORKER_BUILDER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
      },
    }, REQUEST_BUILDER_TTL);
  }

  requestDistributor(orgRoom: OrgRoom, room: Room, trace: Tracer) {
    const numDistributors = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DISTRIBUTOR &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === this.id && creepIsFresh(creep);
    }).length;

    let desiredDistributors = MIN_DISTRIBUTORS;
    if (room.controller.level < 3) {
      desiredDistributors = 1;
    } else if (room.energyAvailable / room.energyCapacityAvailable < 0.5) {
      desiredDistributors = 2;
      // We are less CPU constrained on other shards
      if (Game.shard.name !== 'shard3') {
        desiredDistributors = 3;
      }
    }

    if (!orgRoom.hasStorage || numDistributors >= desiredDistributors) {
      return;
    }

    let distributorPriority = PRIORITIES.PRIORITY_DISTRIBUTOR;
    if (orgRoom.getAmountInReserve(RESOURCE_ENERGY) === 0) {
      distributorPriority = PRIORITIES.DISTRIBUTOR_NO_RESERVE;
    }

    if (orgRoom.getAmountInReserve(RESOURCE_ENERGY) > 25000) {
      distributorPriority += 3;
    }

    (orgRoom as any).requestSpawn(distributorPriority, {
      role: CREEPS.WORKER_DISTRIBUTOR,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
      },
    }, REQUEST_DISTRIBUTOR_TTL);

  }

  requestReserver(kingdom: Kingdom, orgRoom: OrgRoom, room: Room, trace: Tracer) {
    const numReservers = _.filter(Game.creeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_RESERVER) &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === this.id && creepIsFresh(creep);
    }).length;



    let reservationTicks = 0;
    if (room?.controller?.reservation) {
      reservationTicks = room.controller.reservation.ticksToEnd;
    }

    trace.log('deciding to request reserver', {
      numReservers: numReservers,
      ownedByMe: (orgRoom?.reservedByMe || orgRoom?.claimedByMe),
      numHostiles: orgRoom?.numHostiles,
      numDefenders: orgRoom?.numDefenders,
      reservationTicks: (orgRoom?.reservedByMe && reservationTicks) ?
        reservationTicks < MIN_RESERVATION_TICKS : false,
    });

    if (numReservers) {
      return;
    }

    const notOwned = orgRoom && !orgRoom.reservedByMe && !orgRoom.claimedByMe;
    const reservedByMeAndEndingSoon = orgRoom.reservedByMe && reservationTicks < MIN_RESERVATION_TICKS;
    if (notOwned && !orgRoom.numHostiles || reservedByMeAndEndingSoon) {
      trace.log('sending reserve request to colony');

      (orgRoom as any).requestSpawn(PRIORITIES.PRIORITY_RESERVER, {
        role: CREEPS.WORKER_RESERVER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
          [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
        },
      }, REQUEST_RESERVER_TTL);
    }
  }

  requestUpgrader(orgRoom: OrgRoom, room: Room, trace: Tracer) {
    if (!orgRoom.isPrimary) {
      return;
    }

    const numUpgraders = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] == CREEPS.WORKER_UPGRADER &&
        creepIsFresh(creep);
    }).length;

    let parts = 1;
    let desiredUpgraders = MIN_UPGRADERS;
    let maxParts = 15;
    let roomCapacity = 300;

    const reserveEnergy = orgRoom.getAmountInReserve(RESOURCE_ENERGY);
    const reserveBuffer = orgRoom.getReserveBuffer();

    if (!room.controller.my) {
      desiredUpgraders = 0;
    } else if (room.controller.level === 8) {
      parts = (reserveEnergy - reserveBuffer) / 1500;
      desiredUpgraders = 1;
    } else if (orgRoom.hasStorage) {
      roomCapacity = room.energyCapacityAvailable;
      maxParts = (roomCapacity - 300) / 200;
      if (maxParts > 15) {
        maxParts = 15;
      }

      if (room.storage && reserveEnergy > reserveBuffer) {
        parts = (reserveEnergy - reserveBuffer) / 1500;
      } else if (!room.storage && reserveEnergy > 1000) {
        parts = reserveEnergy - 1000 / 1500;
      }

      desiredUpgraders = Math.ceil(parts / maxParts);
    }

    const energyLimit = ((parts - 1) * 200) + 300;

    // As we get more upgraders, lower the priority
    const upgraderPriority = PRIORITIES.PRIORITY_UPGRADER - (numUpgraders * 2);

    // Don't let it create a ton of upgraders
    if (desiredUpgraders > MAX_UPGRADERS) {
      desiredUpgraders = MAX_UPGRADERS;
    }

    for (let i = 0; i < desiredUpgraders - numUpgraders; i++) {
      (orgRoom as any).requestSpawn(upgraderPriority, {
        role: CREEPS.WORKER_UPGRADER,
        energyLimit: energyLimit,
        memory: {
          [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
          [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
        },
      }, REQUEST_UPGRADER_TTL);
    }
  }

  requestHaulDroppedResources(orgRoom: OrgRoom, room: Room, trace: Tracer) {
    if (orgRoom.numHostiles) {
      return;
    }

    const droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES, {
      filter: (resource) => {
        const numAssigned = _.filter((orgRoom as any).getColony().getHaulers(), (hauler: Creep) => {
          return hauler.memory[MEMORY.MEMORY_HAUL_PICKUP] === resource.id;
        }).length;

        return numAssigned === 0;
      },
    });

    const primaryRoom = (orgRoom as any).getColony().getPrimaryRoom();

    droppedResourcesToHaul.forEach((resource) => {
      const dropoff = primaryRoom.getReserveStructureWithRoomForResource(resource.resourceType);
      if (!dropoff) {
        return;
      }

      const loadPriority = 0.8;
      const details = {
        [MEMORY.TASK_ID]: `pickup-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: resource.id,
        [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: resource.resourceType,
      };

      (orgRoom as any).sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
    });
  }
}
