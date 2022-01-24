import {creepIsFresh} from './behavior.commute';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import {DEFENSE_STATUS} from './defense';
import {Event} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom, {RoomAlertLevel} from "./org.room";
import {Process, running, sleeping, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from './os.thread';
import BaseConstructionRunnable from "./runnable.base_construction";
import {getDashboardStream, getLinesStream, HudIndicatorStatus, HudLine, HudEventSet, HudIndicator} from './runnable.debug_hud';
import {LabsManager} from "./runnable.base_labs";
import LinkManager from "./runnable.base_links";
import SpawnManager from "./runnable.base_spawning";
import NukerRunnable from "./runnable.base_nuker";
import TerminalRunnable from "./runnable.base_terminal";
import TowerRunnable from "./runnable.base_tower";
import ObserverRunnable from './runnable.base_observer';
import LogisticsRunnable from './runnable.base_logistics';
import ControllerRunnable from './runnable.base_controller';
import {BaseConfig} from './config';
import RoomRunnable from './runnable.base_room';

const MIN_ENERGY = 100000;
const CREDIT_RESERVE = 100000;

const MIN_UPGRADERS = 1;
const MAX_UPGRADERS = 6;
const UPGRADER_ENERGY = 25000;
const MIN_DISTRIBUTORS = 1;

const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const ENERGY_REQUEST_TTL = 50;
const REQUEST_CLAIMER_TTL = 50;
const REQUEST_REPAIRER_TTL = 30;
const REQUEST_BUILDER_TTL = 30;
const REQUEST_DISTRIBUTOR_TTL = 10;
const REQUEST_UPGRADER_TTL = 25;
const CHECK_SAFE_MODE_TTL = 10;
const HAUL_EXTENSION_TTL = 10;
const RAMPART_ACCESS_TTL = 5;
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

export default class BaseRunnable {
  id: string;
  scheduler: Scheduler;
  defensePosture: DEFENSE_POSTURE;

  // Metrics
  missingProcesses: number;

  threadUpdateProcessSpawning: ThreadFunc;
  threadRequestRepairer: ThreadFunc;
  threadRequestBuilder: ThreadFunc;
  threadRequestDistributor: ThreadFunc;
  threadRequestUpgrader: ThreadFunc;
  threadCheckSafeMode: ThreadFunc;
  threadRequestExtensionFilling: ThreadFunc;
  //threadUpdateRampartAccess: ThreadFunc;
  threadRequestEnergy: ThreadFunc;
  threadProduceStatus: ThreadFunc;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.defensePosture = DEFENSE_POSTURE.UNKNOWN;

    // Metrics
    this.missingProcesses = 0;

    // Threads
    this.threadUpdateProcessSpawning = thread('spawn_room_processes_thread', UPDATE_PROCESSES_TTL)(this.handleProcessSpawning.bind(this));
    this.threadRequestRepairer = thread('request_repairs_thread', REQUEST_REPAIRER_TTL)(this.requestRepairer.bind(this));
    this.threadRequestBuilder = thread('request_builder_thead', REQUEST_BUILDER_TTL)(this.requestBuilder.bind(this));
    this.threadRequestDistributor = thread('request_distributer_thread', REQUEST_DISTRIBUTOR_TTL)(this.requestDistributor.bind(this));
    this.threadRequestUpgrader = thread('request_upgrader_thread', REQUEST_UPGRADER_TTL)(this.requestUpgrader.bind(this));
    this.threadCheckSafeMode = thread('check_safe_mode_thread', CHECK_SAFE_MODE_TTL)(this.checkSafeMode.bind(this));
    this.threadRequestExtensionFilling = thread('request_extension_filling_thread', HAUL_EXTENSION_TTL)(this.requestExtensionFilling.bind(this));
    //this.threadUpdateRampartAccess = thread('update_rampart_access_thread', RAMPART_ACCESS_TTL)(this.updateRampartAccess.bind(this));
    this.threadRequestEnergy = thread('request_energy_thread', ENERGY_REQUEST_TTL)(this.requestEnergy.bind(this));
    this.threadProduceStatus = thread('produce_status_thread', PRODUCE_STATUS_TTL)(this.produceStatus.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');

    trace.log('room run', {
      id: this.id,
    });

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(this.id);
    if (!baseConfig) {
      trace.error("no colony config, terminating", {id: this.id})
      trace.end();
      return terminate();
    }

    const room = Game.rooms[this.id];
    if (!room) {
      trace.notice('cannot find room in game', {id: this.id});
      this.requestClaimer(kingdom, trace);
      trace.end();
      return sleeping(NO_VISION_TTL);
    }

    // TODO try to remove dependency on OrgRoom
    const orgRoom = kingdom.getRoomByName(this.id);
    if (!orgRoom) {
      trace.error("no org room, terminating", {id: this.id})
      trace.end();
      return sleeping(NO_VISION_TTL);
    }

    this.threadUpdateProcessSpawning(trace, baseConfig, orgRoom, room);

    // Defense
    // this.threadUpdateRampartAccess(trace, orgRoom, room);
    this.threadCheckSafeMode(trace, kingdom, room);

    // Logistics
    this.threadRequestEnergy(trace, orgRoom, room);
    this.threadRequestExtensionFilling(trace, orgRoom, room);

    // Creeps
    this.threadRequestBuilder(trace, orgRoom, room);
    this.threadRequestRepairer(trace, orgRoom, room);
    this.threadRequestUpgrader(trace, orgRoom, room);
    this.threadRequestDistributor(trace, orgRoom, room);

    // Inform other processes of room status
    this.threadProduceStatus(trace, kingdom, orgRoom, baseConfig);

    const roomVisual = new RoomVisual(this.id);
    roomVisual.text("O", baseConfig.origin.x, baseConfig.origin.y, {color: '#FFFFFF'});
    roomVisual.text("P", baseConfig.parking.x, baseConfig.parking.y, {color: '#FFFFFF'});

    trace.end();
    return sleeping(MIN_TTL);
  }

  requestClaimer(kingdom: Kingdom, trace: Tracer) {
    const enroute = _.find(Game.creeps, {
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_RESERVER,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.id,
      }
    });

    if (enroute) {
      trace.notice('claimer already enroute', {id: this.id});
      return;
    }

    const request = {
      role: CREEPS.WORKER_RESERVER,
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_RESERVER,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: this.id,
        [MEMORY.MEMORY_BASE]: this.id,
      },
    };

    trace.notice('requesting claimer', {id: this.id, request});

    kingdom.sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_RESERVER, request, REQUEST_CLAIMER_TTL);
  }

  handleProcessSpawning(trace: Tracer, baseConfig: BaseConfig, orgRoom: OrgRoom, room: Room) {
    let missingProcesses = 0;

    // Spawn Manager
    const spawnManagerId = `spawns_${this.id}`
    if (!this.scheduler.hasProcess(spawnManagerId)) {
      trace.log('starting spawn manager', {id: this.id});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(spawnManagerId, 'spawns', Priorities.CORE_LOGISTICS,
        new SpawnManager(spawnManagerId, orgRoom)));

    }

    // Towers
    room.find<StructureTower>(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType === STRUCTURE_TOWER) {
          trace.log('tower', {
            id: structure.id,
            structureType: structure.structureType,
            active: structure.isActive()
          });
        }

        return structure.structureType === STRUCTURE_TOWER && structure.isActive()
      },
    }).forEach((tower) => {
      const towerId = `${tower.id}`
      if (!this.scheduler.hasProcess(towerId)) {
        trace.log('starting tower', {id: tower.id});
        missingProcesses++;

        const process = new Process(towerId, 'towers', Priorities.DEFENCE,
          new TowerRunnable(orgRoom, tower))
        process.setSkippable(false);
        this.scheduler.registerProcess(process);
      }
    });

    room.find<StructureNuker>(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_NUKER && structure.isActive(),
    }).forEach((nuker) => {
      const nukeId = `${nuker.id}`
      if (!this.scheduler.hasProcess(nukeId)) {
        trace.log('starting nuke', {id: nukeId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(nukeId, 'nukes', Priorities.OFFENSE,
          new NukerRunnable(orgRoom, nuker)));
      }
    });

    if (room.terminal?.isActive()) {
      // Terminal runnable
      const terminalId = room.terminal.id;
      if (!this.scheduler.hasProcess(terminalId)) {
        trace.log('starting terminal', {id: terminalId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.DEFENCE,
          new TerminalRunnable(orgRoom, room.terminal)));
      }
    }

    // Link Manager
    const linkManagerId = `links_${this.id}`
    if (!this.scheduler.hasProcess(linkManagerId) && orgRoom.room.storage) {
      trace.log('starting link manager', {id: linkManagerId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(linkManagerId, 'links', Priorities.RESOURCES,
        new LinkManager(linkManagerId, orgRoom)));
    }

    // Labs Manager
    const labsManagerId = `labs_${this.id}`;
    if (!this.scheduler.hasProcess(labsManagerId)) {
      trace.log('starting labs manager', {id: labsManagerId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(labsManagerId, 'labs', Priorities.LOGISTICS,
        new LabsManager(labsManagerId, orgRoom, this.scheduler, trace)));
      missingProcesses++;
    }

    // Construction
    const constructionId = `construction_${this.id}`;
    if (!this.scheduler.hasProcess(constructionId)) {
      trace.log('starting construction', {id: constructionId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(constructionId, 'construction', Priorities.CORE_LOGISTICS,
        new BaseConstructionRunnable(constructionId, orgRoom)));
      missingProcesses++;
    }

    // Observer runnable
    const observerStructures = room.find<StructureObserver>(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_OBSERVER;
      },
    });

    if (observerStructures.length) {
      const observerId = observerStructures[0].id;
      const hasProcess = this.scheduler.hasProcess(observerId);
      if (!hasProcess) {
        trace.log('starting observer', {id: observerId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(observerId, 'observer', Priorities.EXPLORATION,
          new ObserverRunnable(observerId)));
      }
    }

    // Road network
    const logisticsIds = `logistics_${this.id}`;
    const hasLogisticsProcess = this.scheduler.hasProcess(logisticsIds);
    if (!hasLogisticsProcess) {
      trace.log('starting logistics', {id: logisticsIds});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(logisticsIds, 'logistics', Priorities.LOGISTICS,
        new LogisticsRunnable(this.id)));
    }

    // Controller
    const controllerProcessId = room.controller.id
    if (!this.scheduler.hasProcess(controllerProcessId)) {
      trace.log('starting controller', {id: logisticsIds});
      missingProcesses++;

      const controllerRunnable = new ControllerRunnable(room.controller.id);
      this.scheduler.registerProcess(new Process(controllerProcessId, 'colony_manager',
        Priorities.CRITICAL, controllerRunnable));
    }

    // Rooms
    baseConfig.rooms.forEach((room) => {
      const roomId = `room_${room}`;
      const hasRoomProcess = this.scheduler.hasProcess(roomId);
      if (!hasRoomProcess) {
        trace.log('starting room', {id: roomId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(roomId, 'rooms', Priorities.EXPLORATION,
          new RoomRunnable(room, this.scheduler)));
      }
    });

    this.missingProcesses = missingProcesses;
  }

  requestRepairer(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (!orgRoom.isPrimary) {
      trace.log('not primary room, skipping');
      return;
    }

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

    trace.log('need repairers?', {id: this.id, hitsPercentage, numRepairers});

    // Repairer requests
    let desiredRepairers = 0;
    let repairerPriority = PRIORITIES.PRIORITY_REPAIRER;
    if (hitsPercentage < 0.8) {
      trace.log('need more repairers', {id: this.id, hitsPercentage});
      desiredRepairers = 1;
    }

    if (hitsPercentage < 0.6) {
      trace.log('need more repairers', {id: this.id, hitsPercentage});
      desiredRepairers = 2;
      repairerPriority = PRIORITIES.PRIORITY_REPAIRER_URGENT;
    }

    if (Game.cpu.bucket < 1000) {
      trace.log('bucket low', {bucket: Game.cpu.bucket});
      desiredRepairers = 0;
    }

    if (numRepairers >= desiredRepairers) {
      trace.log('already have enough repairers', {id: this.id, numRepairers, desiredRepairers});
      return;
    }

    trace.log('request repairers', {id: this.id, desiredRepairers, numRepairers});

    orgRoom.requestSpawn(repairerPriority, {
      role: CREEPS.WORKER_REPAIRER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      },
    }, REQUEST_REPAIRER_TTL, trace);
  }

  requestBuilder(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (!Object.values(Game.spawns).length) {
      trace.log('no spawns');
      return;
    }

    const builders = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_BUILDER && creepIsFresh(creep);
    });

    const numConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    trace.log('num constructions sites', {numConstructionSites})

    let desiredBuilders = 0;
    if (numConstructionSites) {
      desiredBuilders = desiredBuilders = Math.ceil(numConstructionSites / 10);
    }

    if (desiredBuilders > 3) {
      desiredBuilders = 3;
    }

    trace.log('checking builders', {id: this.id, numConstructionSites, desiredBuilders});

    if (builders.length >= desiredBuilders) {
      trace.log('already have enough builders', {id: this.id, numConstructionSites, desiredBuilders});
      return;
    }

    (orgRoom as any).requestSpawn(PRIORITIES.PRIORITY_BUILDER - (builders.length * 2), {
      role: CREEPS.WORKER_BUILDER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
        [MEMORY.MEMORY_BASE]: (orgRoom as any).getColony().id,
      },
    }, REQUEST_BUILDER_TTL, trace);
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
    if (orgRoom.getAmountInReserve(RESOURCE_ENERGY) === 0) {
      distributorPriority = PRIORITIES.DISTRIBUTOR_NO_RESERVE;
    }

    //if (orgRoom.getAmountInReserve(RESOURCE_ENERGY) > 25000) {
    //  distributorPriority += 3;
    //}

    if (numDistributors === 0) {
      distributorPriority += 10;
    }

    const request = {
      role: CREEPS.WORKER_DISTRIBUTOR,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
        [MEMORY.MEMORY_BASE]: (orgRoom as any).getColony().id,
      },
    };

    trace.log('request distributor', {desiredDistributors, distributorPriority, fullness, request});

    (orgRoom as any).requestSpawn(distributorPriority, request, REQUEST_DISTRIBUTOR_TTL);
  }

  requestUpgrader(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (!orgRoom.isPrimary) {
      return;
    }

    // Wait until we have more than one other base creep
    if (orgRoom.getCreeps().length < 3) {
      trace.notice('not enough creeps to request upgrader');
      return;
    }

    const numUpgraders = _.filter(orgRoom.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] == CREEPS.WORKER_UPGRADER &&
        creepIsFresh(creep);
    }).length;

    let parts = 1;
    let desiredUpgraders = MIN_UPGRADERS;
    let maxParts = 15;

    const reserveEnergy = orgRoom.getAmountInReserve(RESOURCE_ENERGY);
    const reserveBuffer = orgRoom.getReserveBuffer();

    trace.log('upgrader energy', {reserveEnergy, reserveBuffer});

    if (!room.controller?.my) {
      trace.log('not my room')
      desiredUpgraders = 0;
    } else if (room.controller.level === 8) {
      trace.log('max level room')
      parts = (reserveEnergy - reserveBuffer) / 1500;
      desiredUpgraders = 1;
    } else if (orgRoom.hasStorage) {
      trace.log('has storage');

      const roomCapacity = room.energyCapacityAvailable;
      maxParts = Math.floor(roomCapacity / 200);
      if (maxParts > 15) {
        maxParts = 15;
      }

      trace.log('max parts', {maxParts});

      if (room.storage?.isActive() && reserveEnergy > reserveBuffer) {
        parts = (reserveEnergy - reserveBuffer) / 1500;
      } else if (!room.storage && reserveEnergy > 1000) {
        parts = reserveEnergy - 1000 / 1500;
      }

      trace.log('parts', {parts});

      desiredUpgraders = Math.ceil(parts / maxParts);
    } else if (!orgRoom.hasSpawns) {
      desiredUpgraders = 0;
    }

    const energyLimit = ((parts - 1) * 150) + 200;

    // Don't let it create a ton of upgraders
    if (desiredUpgraders > MAX_UPGRADERS) {
      desiredUpgraders = MAX_UPGRADERS;
    }

    trace.log('request upgrader', {
      desiredUpgraders,
      numUpgraders,
      energyLimit,
    });

    for (let i = 0; i < desiredUpgraders - numUpgraders; i++) {
      // Reduce priority by number of existing and requested upgraders
      const upgraderPriority = PRIORITIES.PRIORITY_UPGRADER - ((numUpgraders + i) * 2);
      orgRoom.requestSpawn(upgraderPriority, {
        role: CREEPS.WORKER_UPGRADER,
        energyLimit: energyLimit,
        memory: {
          [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
          [MEMORY.MEMORY_COLONY]: (orgRoom as any).getColony().id,
          [MEMORY.MEMORY_BASE]: (orgRoom as any).getColony().id,
        },
      }, REQUEST_UPGRADER_TTL, trace);
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
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
          structure.isActive();
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
    const terminalEnergy = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

    trace.log('room energy', {
      terminalEnergy,
      storageEnergy,
      roomLevel: orgRoom.getRoomLevel(),
      desiredBuffer: orgRoom.getReserveBuffer(),
      UPGRADER_ENERGY,
      MIN_ENERGY,
    });

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
      const amount = 5000;
      trace.log('requesting energy from governor', {amount, resource: RESOURCE_ENERGY});

      const resourceGovernor = (orgRoom as any).getKingdom().getResourceGovernor();
      const requested = resourceGovernor.requestResource(orgRoom, RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
      if (!requested) {
        resourceGovernor.buyResource(orgRoom, RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
      }
    }
  }

  produceStatus(trace: Tracer, kingdom: Kingdom, orgRoom: OrgRoom, baseConfig: BaseConfig) {
    const resources = orgRoom.getReserveResources();

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

    const line: HudLine = {
      key: `base_${orgRoom.id}`,
      room: orgRoom.id,
      order: 0,
      text: `Base: ${orgRoom.id} - status: ${orgRoom.getAlertLevel()}, level: ${orgRoom.getRoomLevel()}, ` +
        `Auto: ${baseConfig.automated},  Rooms: ${baseConfig.rooms.join(',')}  `,
      time: Game.time,
    };
    const event = new Event(orgRoom.id, Game.time, HudEventSet, line);
    orgRoom.getKingdom().getBroker().getStream(getLinesStream()).publish(event);

    const indicatorStream = orgRoom.getKingdom().getBroker().getStream(getDashboardStream())

    baseConfig.rooms.forEach((roomName) => {
      const orgRoom = kingdom.getRoomByName(roomName);
      if (!orgRoom) {
        trace.warn('room not found', {roomName});
        return;
      }

      // Alert indicator
      let alertLevelStatus = HudIndicatorStatus.Green;
      if (orgRoom.getAlertLevel() === RoomAlertLevel.RED) {
        alertLevelStatus = HudIndicatorStatus.Red;
      } else if (orgRoom.getAlertLevel() === RoomAlertLevel.YELLOW) {
        alertLevelStatus = HudIndicatorStatus.Yellow;
      }
      const alertLevelIndicator: HudIndicator = {
        room: roomName, key: 'alert', display: 'A',
        status: alertLevelStatus
      };
      indicatorStream.publish(new Event(roomName, Game.time, HudEventSet, alertLevelIndicator));
    });

    // Processes
    let processStatus = HudIndicatorStatus.Green;
    if (this.missingProcesses > 1) {
      processStatus = HudIndicatorStatus.Red;
    } else if (this.missingProcesses === 1) {
      processStatus = HudIndicatorStatus.Yellow;
    }

    const keyProcessesIndicator: HudIndicator = {
      room: orgRoom.id, key: 'processes', display: 'P',
      status: processStatus
    };
    indicatorStream.publish(new Event(baseConfig.id, Game.time, HudEventSet, keyProcessesIndicator));
  }
}
