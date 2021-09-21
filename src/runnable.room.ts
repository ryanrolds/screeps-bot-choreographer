import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {thread, ThreadFunc} from './os.thread';

import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";

import {Priorities, Scheduler} from "./os.scheduler";

import LinkManager from "./runnable.manager.links"
import TowerRunnable from "./runnable.tower";
import NukerRunnable from "./runnable.nuker";
import SourceRunnable from "./runnable.source";
import SpawnManager from "./runnable.manager.spawns";
import TerminalRunnable from "./runnable.terminal";
import {LabsManager} from "./runnable.manager.labs";
import {creepIsFresh} from './behavior.commute';

import * as PRIORITIES from './constants.priorities';
import * as MEMORY from './constants.memory';
import * as CREEPS from './constants.creeps';
import * as TOPICS from './constants.topics';
import * as TASKS from './constants.tasks';
import {DEFENSE_STATUS} from './defense';

const MIN_ENERGY = 100000;
const CREDIT_RESERVE = 100000;

const MIN_UPGRADERS = 1;
const MAX_UPGRADERS = 5;
const UPGRADER_ENERGY = 25000;

const MIN_DISTRIBUTORS = 1;

const MIN_RESERVATION_TICKS = 4000;

const ENERGY_REQUEST_TTL = 50;
const REQUEST_REPAIRER_TTL = 30;
const REQUEST_BUILDER_TTL = 30;
const REQUEST_DISTRIBUTOR_TTL = 10;
const REQUEST_RESERVER_TTL = 25;
const REQUEST_UPGRADER_TTL = 25;
const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 15;
const CHECK_SAFE_MODE_TTL = 5;
const HAUL_EXTENSION_TTL = 10;
const RAMPART_ACCESS_TTL = 1;
const UPDATE_PROCESSES_TTL = 10;
const PRODUCE_STATUS_TTL = 25;

enum DEFENSE_POSTURE {
  OPEN = 'open',
  CLOSED = 'closed',
  UNKNOWN = 'unknown',
};

const importantStructures = [
  STRUCTURE_SPAWN,
  STRUCTURE_STORAGE,
  STRUCTURE_TERMINAL,
  STRUCTURE_TOWER,
];

export default class RoomRunnable {
  id: string;
  scheduler: Scheduler;
  requestEnergyTTL: number;
  prevTime: number;
  defensePosture: DEFENSE_POSTURE;

  threadUpdateProcessSpawning: ThreadFunc;
  threadRequestRepairer: ThreadFunc;
  threadRequestBuilder: ThreadFunc;
  threadRequestDistributor: ThreadFunc;
  threadRequestReserver: ThreadFunc;
  threadRequestUpgrader: ThreadFunc;
  threadRequestHaulDroppedResources: ThreadFunc;
  threadRequestHaulTombstones: ThreadFunc;
  threadCheckSafeMode: ThreadFunc;
  threadRequestExtensionFilling: ThreadFunc;
  //threadUpdateRampartAccess: ThreadFunc;
  threadRequestEnergy: ThreadFunc;
  threadProduceStatus: ThreadFunc;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.requestEnergyTTL = ENERGY_REQUEST_TTL;
    this.prevTime = Game.time;
    this.defensePosture = DEFENSE_POSTURE.UNKNOWN;

    // Threads
    this.threadUpdateProcessSpawning = thread('spawn_room_processes_thread', UPDATE_PROCESSES_TTL)(this.handleProcessSpawning.bind(this));
    this.threadRequestRepairer = thread('request_repairs_thread', REQUEST_REPAIRER_TTL)(this.requestRepairer.bind(this));
    this.threadRequestBuilder = thread('request_builder_thead', REQUEST_BUILDER_TTL)(this.requestBuilder.bind(this));
    this.threadRequestDistributor = thread('request_distributer_thread', REQUEST_DISTRIBUTOR_TTL)(this.requestDistributor.bind(this));
    this.threadRequestReserver = thread('request_reserver_thread', REQUEST_RESERVER_TTL)(this.requestReserver.bind(this));
    this.threadRequestUpgrader = thread('request_upgrader_thread', REQUEST_UPGRADER_TTL)(this.requestUpgrader.bind(this));
    this.threadRequestHaulDroppedResources = thread('request_haul_dropped_thread', REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulDroppedResources.bind(this));
    this.threadRequestHaulTombstones = thread('request_haul_tombstone_thread', REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulTombstones.bind(this));
    this.threadCheckSafeMode = thread('check_safe_mode_thread', CHECK_SAFE_MODE_TTL)(this.checkSafeMode.bind(this));
    this.threadRequestExtensionFilling = thread('request_extension_filling_thread', HAUL_EXTENSION_TTL)(this.requestExtensionFilling.bind(this));
    //this.threadUpdateRampartAccess = thread('update_rampart_access_thread', RAMPART_ACCESS_TTL)(this.updateRampartAccess.bind(this));
    this.threadRequestEnergy = thread('request_energy_thread', ENERGY_REQUEST_TTL)(this.requestEnergy.bind(this));
    this.threadProduceStatus = thread('produce_status_thread', PRODUCE_STATUS_TTL)(this.produceStatus.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id).begin('room_run');

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.requestEnergyTTL -= ticks;

    trace.log('room run', {
      id: this.id,
    });

    const orgRoom = kingdom.getRoomByName(this.id);
    // TODO implement room class
    if (!orgRoom) {
      trace.end();
      return terminate();
    }

    const room = Game.rooms[this.id];
    if (!room) {
      trace.log('cannot find room in game', {});
      trace.end();
      return terminate();
    }

    if (!orgRoom.isPrimary) {
      this.threadRequestReserver(trace, kingdom, orgRoom, room);
    }

    if (room.controller?.my) {
      // Send a request if we are short on distributors
      this.threadRequestDistributor(trace, orgRoom, room);
      // Upgrader request
      this.threadRequestUpgrader(trace, orgRoom, room);

      //this.threadUpdateRampartAccess(trace, orgRoom, room);
      this.threadRequestExtensionFilling(trace, orgRoom, room);
      this.threadCheckSafeMode(trace, kingdom, room);
      this.threadProduceStatus(trace, orgRoom);
    }

    this.threadUpdateProcessSpawning(trace, orgRoom, room);

    // TODO don't request builders or repairers
    this.threadRequestBuilder(trace, orgRoom, room);
    this.threadRequestRepairer(trace, orgRoom, room);
    this.threadRequestEnergy(trace, orgRoom, room);
    this.threadRequestHaulDroppedResources(trace, orgRoom, room);
    this.threadRequestHaulTombstones(trace, orgRoom, room);

    trace.end();
    return running();
  }

  handleProcessSpawning(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (orgRoom.isPrimary) {
      // Spawn Manager
      const spawnManagerId = `spawns_${this.id}`
      if (!this.scheduler.hasProcess(spawnManagerId)) {
        this.scheduler.registerProcess(new Process(spawnManagerId, 'spawns', Priorities.CORE_LOGISTICS,
          new SpawnManager(spawnManagerId, orgRoom)));
      }

      // Towers
      room.find<StructureTower>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_TOWER,
      }).forEach((tower) => {
        const towerId = `${tower.id}`
        if (!this.scheduler.hasProcess(towerId)) {
          const process = new Process(towerId, 'towers', Priorities.DEFENCE,
            new TowerRunnable(orgRoom, tower))
          process.setSkippable(false);
          this.scheduler.registerProcess(process);
        }
      });

      room.find<StructureNuker>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_NUKER,
      }).forEach((nuker) => {
        const nukeId = `${nuker.id}`
        if (!this.scheduler.hasProcess(nukeId)) {
          this.scheduler.registerProcess(new Process(nukeId, 'nukes', Priorities.OFFENSE,
            new NukerRunnable(orgRoom, nuker)));
        }
      });

      if (room.terminal) {
        // Terminal runnable
        const terminalId = room.terminal.id;
        if (!this.scheduler.hasProcess(terminalId)) {
          this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.DEFENCE,
            new TerminalRunnable(orgRoom, room.terminal)));
        }
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
      }

      // Link Manager
      const linkManagerId = `links_${this.id}`
      if (!this.scheduler.hasProcess(linkManagerId) && orgRoom.room.storage) {
        this.scheduler.registerProcess(new Process(linkManagerId, 'links', Priorities.RESOURCES,
          new LinkManager(linkManagerId, orgRoom)));
      }

      // Labs Manager
      const labsManagerId = `labs_${this.id}`;
      if (!this.scheduler.hasProcess(labsManagerId)) {
        this.scheduler.registerProcess(new Process(labsManagerId, 'labs', Priorities.LOGISTICS,
          new LabsManager(labsManagerId, orgRoom, this.scheduler, trace)));
      }

      // Observer runnable
    }
  }

  requestRepairer(trace: Tracer, orgRoom: OrgRoom, room: Room) {
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

    if (Game.cpu.bucket < 1000) {
      desiredRepairers = 0;
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

  requestBuilder(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (!Object.values(Game.spawns).length) {
      // We have no spawns in this shard
      return;
    }

    const builders = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_BUILDER && creepIsFresh(creep);
    });

    const numConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    trace.log('num constructions sites', {numConstructionSites})

    let desiredBuilders = 0;
    if (numConstructionSites && (orgRoom.reservedByMe || orgRoom.claimedByMe)) {
      desiredBuilders = 3;
      if (room.controller.level > 2) {
        desiredBuilders = desiredBuilders = Math.ceil(numConstructionSites / 10);
      }
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

  requestDistributor(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    const numDistributors = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DISTRIBUTOR &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === this.id && creepIsFresh(creep);
    }).length;

    let desiredDistributors = MIN_DISTRIBUTORS;
    if (room.controller.level < 3) {
      desiredDistributors = 1;
    }

    const fullness = room.energyAvailable / room.energyCapacityAvailable;
    if (room.controller.level >= 3 && fullness < 0.5) {
      desiredDistributors = 3;
    }

    const numCoreHaulTasks = orgRoom.getColony().getTopicLength(TOPICS.HAUL_CORE_TASK);
    if (numCoreHaulTasks > 30) {
      desiredDistributors = 2;
    }
    if (numCoreHaulTasks > 50) {
      desiredDistributors = 3;
    }

    if (orgRoom.numHostiles) {
      const numTowers = room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_TOWER;
        }
      }).length;

      trace.log('hostiles in room and we need more distributors', {numTowers, desiredDistributors});
      desiredDistributors = Math.ceil(numTowers / 2) + desiredDistributors;
    }

    if (Game.cpu.bucket < 1000) {
      trace.log('low CPU, limit distributors');
      desiredDistributors = 1;
    }

    if (!orgRoom.hasStorage || numDistributors >= desiredDistributors) {
      trace.log('do not request distributors', {
        hasStorage: orgRoom.hasStorage,
        numDistributors,
        desiredDistributors,
        roomLevel: room.controller.level,
        fullness,
        numCoreHaulTasks,
        numHostiles: orgRoom.numHostiles,
      });
      return;
    }

    let distributorPriority = PRIORITIES.PRIORITY_DISTRIBUTOR;
    if (orgRoom.getAmountInReserve(RESOURCE_ENERGY, false) === 0) {
      distributorPriority = PRIORITIES.DISTRIBUTOR_NO_RESERVE;
    }

    if (orgRoom.getAmountInReserve(RESOURCE_ENERGY, false) > 25000) {
      distributorPriority += 3;
    }

    trace.log('request distributor', {desiredDistributors});

    (orgRoom as any).requestSpawn(distributorPriority, {
      role: CREEPS.WORKER_DISTRIBUTOR,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
      },
    }, REQUEST_DISTRIBUTOR_TTL);

  }

  requestReserver(trace: Tracer, kingdom: Kingdom, orgRoom: OrgRoom, room: Room) {
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

      const details = {
        role: CREEPS.WORKER_RESERVER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
          [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
        },
      }

      if (orgRoom.getColony().primaryRoom.energyCapacityAvailable < 800) {
        orgRoom.getKingdom().sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_RESERVER,
          details, REQUEST_RESERVER_TTL);
      } else {
        orgRoom.requestSpawn(PRIORITIES.PRIORITY_RESERVER, details, REQUEST_RESERVER_TTL);
      }
    }
  }

  requestUpgrader(trace: Tracer, orgRoom: OrgRoom, room: Room) {
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

    const reserveEnergy = orgRoom.getAmountInReserve(RESOURCE_ENERGY, false);
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
    } else if (!orgRoom.hasSpawns) {
      desiredUpgraders = 0;
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

  requestExtensionFilling(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    const pickup = orgRoom.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, true);
    if (!pickup) {
      trace.log('no energy available for extensions', {resource: RESOURCE_ENERGY});
      return;
    }

    const nonFullExtensions = room.find<StructureExtension>(FIND_STRUCTURES, {
      filter: (structure) => {
        return (structure.structureType === STRUCTURE_EXTENSION ||
          structure.structureType === STRUCTURE_SPAWN) &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      }
    });

    nonFullExtensions.forEach((extension) => {
      const details = {
        [MEMORY.TASK_ID]: `ext-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: extension.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: extension.store.getFreeCapacity(RESOURCE_ENERGY),
      };

      (orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_EXTENSION, details, HAUL_EXTENSION_TTL);
    });

    trace.log('haul extensions', {numHaulTasks: nonFullExtensions.length});
  }

  requestHaulDroppedResources(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (orgRoom.numHostiles) {
      return;
    }

    let droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES, {
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

      const details = {
        [MEMORY.TASK_ID]: `pickup-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: resource.id,
        [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: resource.resourceType,
        [MEMORY.MEMORY_HAUL_AMOUNT]: resource.amount,
      };

      let topic = TOPICS.TOPIC_HAUL_TASK;
      let priority = PRIORITIES.HAUL_DROPPED;
      if (orgRoom.isPrimary) {
        //topic = TOPICS.HAUL_CORE_TASK;
        //priority = PRIORITIES.HAUL_CORE_DROPPED;
      }


      trace.log('haul dropped', {topic, priority, details});

      (orgRoom as any).sendRequest(topic, priority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
    });
  }

  requestHaulTombstones(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (orgRoom.numHostiles) {
      return;
    }

    const tombstones = room.find(FIND_TOMBSTONES, {
      filter: (tombstone) => {
        const numAssigned = _.filter((orgRoom as any).getColony().getHaulers(), (hauler: Creep) => {
          return hauler.memory[MEMORY.MEMORY_HAUL_PICKUP] === tombstone.id;
        }).length;

        return numAssigned === 0;
      },
    });

    const primaryRoom = (orgRoom as any).getColony().getPrimaryRoom();

    tombstones.forEach((tombstone) => {
      Object.keys(tombstone.store).forEach((resourceType) => {
        trace.log("tombstone", {id: tombstone.id, resource: resourceType, amount: tombstone.store[resourceType]});
        const dropoff = primaryRoom.getReserveStructureWithRoomForResource(resourceType);
        if (!dropoff) {
          return;
        }

        const details = {
          [MEMORY.TASK_ID]: `pickup-${this.id}-${Game.time}`,
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
          [MEMORY.MEMORY_HAUL_PICKUP]: tombstone.id,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: resourceType,
          [MEMORY.MEMORY_HAUL_AMOUNT]: tombstone.store[resourceType],
        };

        let topic = TOPICS.TOPIC_HAUL_TASK;
        let priority = PRIORITIES.HAUL_DROPPED;
        if (orgRoom.isPrimary) {
          topic = TOPICS.HAUL_CORE_TASK;
          priority = PRIORITIES.HAUL_CORE_DROPPED;
        }

        trace.log('haul tombstone', {topic, priority, details});

        (orgRoom as any).sendRequest(topic, priority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
      });
    });
  }

  updateRampartAccess(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    const colony = (orgRoom as any).getColony()
    if (!colony) {
      trace.log('could not find colony')
      return;
    }

    const message = colony.peekNextRequest(TOPICS.DEFENSE_STATUSES);
    if (!message) {
      trace.log('did not find a defense status, fail closed');
      this.setRamparts(room, DEFENSE_POSTURE.CLOSED, trace);
      return;
    }

    const status = message.details.status;
    const isPublic = colony.isPublic;

    trace.log('rampart access', {status, isPublic, posture: this.defensePosture})

    if ((!isPublic || status !== DEFENSE_STATUS.GREEN) && this.defensePosture !== DEFENSE_POSTURE.CLOSED) {
      trace.notice('setting ramparts closed');
      this.setRamparts(room, DEFENSE_POSTURE.CLOSED, trace);
    }

    if (status === DEFENSE_STATUS.GREEN && isPublic && this.defensePosture !== DEFENSE_POSTURE.OPEN) {
      trace.notice('setting ramparts open');
      this.setRamparts(room, DEFENSE_POSTURE.OPEN, trace);
    }
  }

  setRamparts(room: Room, posture: DEFENSE_POSTURE, trace: Tracer) {
    const isPublic = posture === DEFENSE_POSTURE.OPEN;
    // Close all ramparts
    room.find<StructureRampart>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_RAMPART;
      }
    }).forEach((rampart) => {
      rampart.setPublic(isPublic);
    });
    this.defensePosture = posture;
  }

  checkSafeMode(trace: Tracer, kingdom: Kingdom, room: Room) {
    const controller = room.controller;
    if (!controller) {
      trace.log('controller not found');
      return;
    }

    let enableSafeMode = false;

    let hostiles = room.find(FIND_HOSTILE_CREEPS);

    // Filter friendly creeps
    const friends = kingdom.config.friends;
    hostiles = hostiles.filter(creep => friends.indexOf(creep.owner.username) === -1);

    if (hostiles) {
      const infrastructure = room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return _.find(importantStructures, structure.structureType);
        }
      });

      for (const structure of infrastructure) {
        if (structure.pos.findInRange(hostiles, 3).length > 3) {
          enableSafeMode = true;
          break;
        }
      }
    }

    if (enableSafeMode) {
      if (controller.safeMode) {
        trace.log('safe mode already active');
        return;
      }

      // If hostiles present spawn defenders and/or activate safe mode
      if (controller.safeModeAvailable && !controller.safeMode && !controller.safeModeCooldown) {
        controller.activateSafeMode();
        trace.log('activating safe mode');
        return;
      }
    } else {
      trace.log('do not enable safe mode');
    }
  }

  requestEnergy(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    // TODO make thread
    const terminalEnergy = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

    trace.log('room energy', {
      requestEnergyTTL: this.requestEnergyTTL,
      terminalEnergy,
      storageEnergy,
      roomLevel: orgRoom.getRoomLevel(),
      desiredBuffer: orgRoom.getReserveBuffer(),
      UPGRADER_ENERGY,
      MIN_ENERGY,
    });

    // dont request energy if ttl on previous request not passed
    if (this.requestEnergyTTL > 0) {
      return;
    }

    let requestEnergy = false;

    // if we are below minimum energy, request more
    if (storageEnergy + terminalEnergy < MIN_ENERGY) {
      requestEnergy = true;
    }

    /*
    // If not level 8, request more energy then buffer for upgrades
    if (Game.market.credits > CREDIT_RESERVE && orgRoom.getRoomLevel() < 8 &&
      storageEnergy + terminalEnergy < orgRoom.getReserveBuffer() + UPGRADER_ENERGY) {
      requestEnergy = true;
    }
    */

    if (requestEnergy) {
      this.requestEnergyTTL = ENERGY_REQUEST_TTL;
      const amount = 5000;
      trace.log('requesting energy from governor', {amount, resource: RESOURCE_ENERGY});

      const resourceGovernor = (orgRoom as any).getKingdom().getResourceGovernor();
      const requested = resourceGovernor.requestResource(orgRoom, RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
      if (!requested) {
        resourceGovernor.buyResource(orgRoom, RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
      }
    }
  }

  produceStatus(trace: Tracer, orgRoom: OrgRoom) {
    const resources = orgRoom.getReserveResources(false);

    const status = {
      [MEMORY.ROOM_STATUS_NAME]: orgRoom.id,
      [MEMORY.ROOM_STATUS_LEVEL]: orgRoom.getRoomLevel(),
      [MEMORY.ROOM_STATUS_LEVEL_COMPLETED]: orgRoom.getRoomLevelCompleted(),
      [MEMORY.ROOM_STATUS_TERMINAL]: orgRoom.hasTerminal(),
      [MEMORY.ROOM_STATUS_ENERGY]: resources[RESOURCE_ENERGY] || 0,
      [MEMORY.ROOM_STATUS_ALERT_LEVEL]: orgRoom.getAlertLevel(),
    };

    trace.log('producing room status', {status});

    orgRoom.getKingdom().sendRequest(TOPICS.ROOM_STATUES, 1, status, PRODUCE_STATUS_TTL);
  }
}
