import * as CREEPS from '../constants/creeps';
import {DEFENSE_STATUS} from '../constants/defense';
import * as MEMORY from '../constants/memory';
import * as PRIORITIES from '../constants/priorities';
import * as TOPICS from '../constants/topics';
import {scoreAttacking} from '../creeps/roles/harasser';
import {
  getDashboardStream, getLinesStream, HudEventSet, HudIndicator, HudIndicatorStatus,
  HudLine
} from '../debug/hud';
import {Event} from '../lib/event_broker';
import {Tracer} from '../lib/tracing';
import {RoomEntry} from '../managers/scribe';
import {
  AlertLevel, Base, BaseThreadFunc, getBaseLevel, getBaseLevelCompleted,
  getBasePrimaryRoom, getReserveBuffer, getStoredResourceAmount, getStoredResources, setBoostPosition, setLabsByAction, threadBase
} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {Process, RunnableResult, sleeping, terminate} from '../os/process';
import {Priorities, Scheduler} from '../os/scheduler';
import {BaseRoomThreadFunc, threadBaseRoom} from '../os/threads/base_room';
import {BoosterDetails, getBaseBoostTopic} from './booster';
import BaseConstructionRunnable from './construction';
import ControllerRunnable from './controller';
import DefenseManager from './defense';
import {LabsManager} from './labs';
import LinkManager from './links';
import LogisticsRunnable from './logistics';
import {NeighborsRunnable} from './neighbors';
import NukerRunnable from './nuker';
import {ObserverRunnable} from './observer';
import {RemotesManager} from './remotes';
import RepairRunnable from './repair';
import RoomRunnable from './room';
import SpawnManager, {createSpawnRequest, getBaseSpawnTopic, getShardSpawnTopic} from './spawning';
import TerminalRunnable from './terminal';
import TowerRunnable from './tower';
import {WallsRunnable} from './walls';

const MIN_ENERGY = 100000;
const MIN_TICKS_TO_DOWNGRADE = 150000;

const MIN_UPGRADERS = 1;
const MAX_UPGRADERS = 10;
const UPGRADER_ENERGY = 25000;

const MAX_EXPLORERS = 3;

const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const ENERGY_REQUEST_TTL = 50;
const REQUEST_CLAIMER_TTL = 50;
const REQUEST_REPAIRER_TTL = 30;
const REQUEST_BUILDER_TTL = 30;

const REQUEST_UPGRADER_TTL = 30;
const CHECK_SAFE_MODE_TTL = 10;
const UPDATE_PROCESSES_TTL = 20;
const PRODUCE_STATUS_TTL = 30;
const ABANDON_BASE_TTL = 50;
const REQUEST_EXPLORER_TTL = 100;
const UPDATE_BOOSTER_TTL = 5;

const MIN_HOSTILE_ATTACK_SCORE_TO_ABANDON = 3000;
const HOSTILE_DAMAGE_THRESHOLD = 0;
const HOSTILE_HEALING_THRESHOLD = 600;

const MAX_CLAIM_RANGE = 4;

enum DEFENSE_POSTURE {
  OPEN = 'open',
  CLOSED = 'closed',
  UNKNOWN = 'unknown',
}

const importantStructures = [
  STRUCTURE_SPAWN,
  STRUCTURE_STORAGE,
  STRUCTURE_TERMINAL,
  STRUCTURE_TOWER,
];

export type BaseStatus = {
  [MEMORY.BASE_STATUS_NAME]: string;
  [MEMORY.BASE_STATUS_LEVEL]: number;
  [MEMORY.BASE_STATUS_LEVEL_COMPLETED]: number;
  [MEMORY.BASE_STATUS_TERMINAL]: boolean,
  [MEMORY.BASE_STATUS_ENERGY]: number,
  [MEMORY.BASE_STATUS_ALERT_LEVEL]: AlertLevel,
}

export default class BaseRunnable {
  id: string;
  scheduler: Scheduler;
  defensePosture: DEFENSE_POSTURE;

  // Metrics
  missingProcesses: number;

  threadUpdateProcessSpawning: BaseRoomThreadFunc;

  threadRequestRepairer: BaseRoomThreadFunc;
  threadRequestBuilder: BaseRoomThreadFunc;
  threadRequestUpgrader: BaseRoomThreadFunc;
  threadRequestExplorer: BaseRoomThreadFunc;

  threadUpdateBoosters: BaseRoomThreadFunc;
  threadCheckSafeMode: BaseRoomThreadFunc;

  // threadUpdateRampartAccess: BaseRoomThreadFunc;
  threadRequestEnergy: BaseRoomThreadFunc;
  threadProduceStatus: BaseRoomThreadFunc;
  threadAbandonBase: BaseRoomThreadFunc;
  threadUpdateAlertLevel: BaseThreadFunc;


  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.defensePosture = DEFENSE_POSTURE.UNKNOWN;

    // Metrics
    this.missingProcesses = 0;

    // Threads
    this.threadUpdateProcessSpawning = threadBaseRoom('spawn_room_processes_thread', UPDATE_PROCESSES_TTL)(this.handleProcessSpawning.bind(this));

    this.threadRequestRepairer = threadBaseRoom('request_repairs_thread', REQUEST_REPAIRER_TTL)(this.requestRepairer.bind(this));
    this.threadRequestBuilder = threadBaseRoom('request_builder_thead', REQUEST_BUILDER_TTL)(this.requestBuilder.bind(this));
    this.threadRequestUpgrader = threadBaseRoom('request_upgrader_thread', REQUEST_UPGRADER_TTL)(this.requestUpgrader.bind(this));
    this.threadRequestExplorer = threadBaseRoom('request_explorers_thread', REQUEST_EXPLORER_TTL)(this.requestExplorer.bind(this));

    this.threadCheckSafeMode = threadBaseRoom('check_safe_mode_thread', CHECK_SAFE_MODE_TTL)(this.checkSafeMode.bind(this));

    // this.threadUpdateRampartAccess = threadBaseRoom('update_rampart_access_thread', RAMPART_ACCESS_TTL)(this.updateRampartAccess.bind(this));
    this.threadRequestEnergy = threadBaseRoom('request_energy_thread', ENERGY_REQUEST_TTL)(this.requestEnergy.bind(this));
    this.threadProduceStatus = threadBaseRoom('produce_status_thread', PRODUCE_STATUS_TTL)(this.produceStatus.bind(this));
    this.threadAbandonBase = threadBaseRoom('abandon_base_check', ABANDON_BASE_TTL)(this.abandonBase.bind(this));
    this.threadUpdateAlertLevel = threadBaseRoom('update_alert_level_thread', UPDATE_PROCESSES_TTL)(this.updateAlertLevel.bind(this));

    // Pump events from booster runnable and set booster state on the Base
    this.threadUpdateBoosters = threadBase('update_booster_thread', UPDATE_BOOSTER_TTL)(this.updateBoosters.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');

    trace.info('room run', {
      id: this.id,
    });

    const base = kernel.getPlanner().getBaseById(this.id);
    if (!base) {
      trace.error('no base config, terminating', {base: this.id});
      trace.end();
      return terminate();
    }

    // if room not visible, request room be claimed
    const room = getBasePrimaryRoom(base);
    if (!room || room.controller?.level === 0) {
      trace.info('room not visible, requesting claim', {room: room?.name});

      // Find at at least one room within max claim range, otherwise remove base and terminate
      const nearbyRoom = kernel.getPlanner().getBases().find((otherBase) => {
        // Dont use self
        if (otherBase.id === base.id) {
          return false;
        }

        // Don't use bases with no visibility or low level
        const otherBaseRoom = getBasePrimaryRoom(otherBase);
        if (!otherBaseRoom || otherBaseRoom.controller?.level === 0) {
          return false;
        }

        const distance = Game.map.getRoomLinearDistance(base.primary, otherBase.primary);
        return distance <= MAX_CLAIM_RANGE;
      });

      if (!nearbyRoom) {
        trace.error('no nearby room, terminating', {base: this.id, nearbyRoom});
        trace.end();
        kernel.getPlanner().removeBase(base.id, trace);
        return terminate();
      }

      // Within max claim range, request claimer to claim room
      trace.notice('cannot see room or level 0', {base: this.id, nearbyRoom});
      this.requestClaimer(kernel, trace);
      trace.end();
      return sleeping(NO_VISION_TTL);
    }

    this.threadUpdateProcessSpawning(trace, kernel, base, room);

    // Base life cycle
    this.threadAbandonBase(trace, kernel, base, room);

    // Defense
    // this.threadUpdateRampartAccess(trace, base, room);
    this.threadCheckSafeMode(trace, kernel, base, room);

    // Logistics
    this.threadRequestEnergy(trace, kernel, base, room);

    // Creeps
    this.threadRequestUpgrader(trace, kernel, base, room);

    if (base.alertLevel === AlertLevel.GREEN) {
      this.threadRequestBuilder(trace, kernel, base, room);
      this.threadRequestRepairer(trace, kernel, base, room);
      this.threadRequestExplorer(trace, kernel, base, room);
    }

    // Inform other processes of room status
    this.threadProduceStatus(trace, kernel, base, room);

    // Alert level
    this.threadUpdateAlertLevel(trace, kernel, base);

    const roomVisual = new RoomVisual(base.primary);
    roomVisual.text('O', base.origin.x, base.origin.y, {color: '#FFFFFF'});
    roomVisual.text('P', base.parking.x, base.parking.y, {color: '#FFFFFF'});

    trace.end();
    return sleeping(MIN_TTL);
  }

  abandonBase(trace: Tracer, kernel: Kernel, base: Base, room: Room): void {
    trace = trace.begin('abandon_base');

    trace.info('abandoning base check', {
      base: this.id,
    });

    // If room has large hostile presence, no spawns, and no towers, abandon base
    // TODO attempt to resist, by sending groups of defenders from nearby bases

    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS);
    const hostileAttackScore = hostileCreeps.reduce((acc, hostile) => {
      return acc + scoreAttacking(hostile);
    }, 0);

    if (hostileAttackScore < MIN_HOSTILE_ATTACK_SCORE_TO_ABANDON) {
      trace.end();
      return;
    }

    trace.notice('hostile creeps detected', {
      hostileScore: hostileAttackScore,
    });

    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length > 0) {
      return;
    }

    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER && structure.isActive();
      },
    });

    if (towers.length > 0) {
      return;
    }

    if (room.controller?.level > 4) {
      return;
    }

    trace.warn('abandoning base', {
      id: this.id,
    });

    // kernel.getPlanner().removeBase(base.id, trace);

    trace.end();
  }

  requestClaimer(kernel: Kernel, trace: Tracer) {
    const enroute = _.find(Game.creeps, {
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_RESERVER,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_BASE]: this.id,
      },
    });

    if (enroute) {
      trace.notice('claimer already enroute', {id: this.id, name: enroute.name, pos: enroute.pos});
      return;
    }

    const detail = {
      role: CREEPS.WORKER_RESERVER,
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_RESERVER,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_BASE]: this.id,
      },
    };

    trace.notice('requesting claimer', {id: this.id, detail});

    kernel.getTopics().addRequest(getShardSpawnTopic(), PRIORITIES.PRIORITY_RESERVER,
      detail, REQUEST_CLAIMER_TTL);
  }

  handleProcessSpawning(trace: Tracer, kernel: Kernel, base: Base, primaryRoom: Room) {
    let missingProcesses = 0;

    // Spawn Manager
    const spawnManagerId = `spawns_${base.id}`;
    if (!this.scheduler.hasProcess(spawnManagerId)) {
      trace.info('starting spawn manager', {id: this.id});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(spawnManagerId, 'spawns', Priorities.CORE_LOGISTICS,
        new SpawnManager(spawnManagerId, base.id)));
    }

    // Towers
    primaryRoom.find<StructureTower>(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER && structure.isActive();
      },
    }).forEach((tower) => {
      const towerId = `${tower.id}`;
      if (!this.scheduler.hasProcess(towerId)) {
        trace.info('starting tower', {id: tower.id});
        missingProcesses++;

        const process = new Process(towerId, 'towers', Priorities.DEFENCE,
          new TowerRunnable(this.id, tower));
        process.setSkippable(false);
        this.scheduler.registerProcess(process);
      }
    });

    // Nukes
    primaryRoom.find<StructureNuker>(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_NUKER && structure.isActive(),
    }).forEach((nuker) => {
      const nukeId = `${nuker.id}`;
      if (!this.scheduler.hasProcess(nukeId)) {
        trace.info('starting nuke', {id: nukeId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(nukeId, 'nukes', Priorities.OFFENSE,
          new NukerRunnable(this.id, nuker)));
      }
    });

    if (primaryRoom.terminal?.isActive()) {
      // Terminal runnable
      const terminalId = primaryRoom.terminal.id;
      if (!this.scheduler.hasProcess(terminalId)) {
        trace.info('starting terminal', {id: terminalId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.DEFENCE,
          new TerminalRunnable(this.id, primaryRoom.terminal)));
      }
    }

    // Link Manager
    const linkManagerId = `links_${this.id}`;
    if (!this.scheduler.hasProcess(linkManagerId) && primaryRoom.storage) {
      trace.info('starting link manager', {id: linkManagerId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(linkManagerId, 'links', Priorities.RESOURCES,
        new LinkManager(linkManagerId, this.id)));
    }

    // Labs Manager
    const labsManagerId = `labs_${this.id}`;
    if (!this.scheduler.hasProcess(labsManagerId)) {
      trace.info('starting labs manager', {id: labsManagerId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(labsManagerId, 'labs', Priorities.LOGISTICS,
        new LabsManager(base.id, labsManagerId, this.scheduler, trace)));
      missingProcesses++;
    }

    // Construction
    const constructionId = `construction_${this.id}`;
    if (!this.scheduler.hasProcess(constructionId)) {
      trace.info('starting construction', {id: constructionId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(constructionId, 'construction', Priorities.CORE_LOGISTICS,
        new BaseConstructionRunnable(base.id, constructionId)));
      missingProcesses++;
    }

    // Remotes
    const remotesManagerId = `remotes_${this.id}`;
    if (!this.scheduler.hasProcess(remotesManagerId)) {
      trace.info('starting remote manager', {id: remotesManagerId});
      missingProcesses++;
      this.scheduler.registerProcess(new Process(remotesManagerId, 'remotes', Priorities.CORE_LOGISTICS,
        new RemotesManager(this.id)));
    }


    // Rooms
    base.rooms.forEach((room) => {
      const roomId = `room_${room}`;
      const hasRoomProcess = this.scheduler.hasProcess(roomId);
      if (!hasRoomProcess) {
        trace.info('starting room', {id: roomId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(roomId, 'rooms', Priorities.CRITICAL,
          new RoomRunnable(room, this.scheduler)));
      }
    });

    // Controller
    const controllerProcessId = primaryRoom.controller.id;
    if (!this.scheduler.hasProcess(controllerProcessId)) {
      trace.info('starting controller', {id: primaryRoom.controller.id});
      missingProcesses++;

      const controllerRunnable = new ControllerRunnable(primaryRoom.controller.id);
      this.scheduler.registerProcess(new Process(controllerProcessId, 'controller',
        Priorities.CRITICAL, controllerRunnable));
    }

    // Road network and hauling
    const logisticsId = `logistics_${this.id}`;
    const hasLogisticsProcess = this.scheduler.hasProcess(logisticsId);
    if (!hasLogisticsProcess) {
      trace.info('starting logistics', {id: logisticsId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(logisticsId, 'logistics', Priorities.LOGISTICS,
        new LogisticsRunnable(this.id)));
    }

    // Walls
    const wallsId = `walls_${this.id}`;
    const hasWallsProcess = this.scheduler.hasProcess(wallsId);
    if (!hasWallsProcess) {
      trace.info('starting walls', {id: wallsId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(wallsId, 'walls', Priorities.DEFENCE,
        new WallsRunnable(this.id)));
    }

    // Neighbors
    const neighborsId = `neighbors_${this.id}`;
    if (!this.scheduler.hasProcess(neighborsId)) {
      trace.info('starting neighbors', {id: neighborsId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(neighborsId, 'neighbors', Priorities.CRITICAL,
        new NeighborsRunnable(this.id)));
    }

    const defenseManagerId = `defense_manager_${this.id}`;
    if (!this.scheduler.hasProcess(defenseManagerId)) {
      // Defense manager, must run before towers and defenders
      const defenseManager = new DefenseManager(kernel, base, trace);
      this.scheduler.registerProcess(new Process(defenseManagerId, 'defense_manager',
        Priorities.CRITICAL, defenseManager));
    }

    // Repairs
    const repairId = `repair_${this.id}`;
    if (!this.scheduler.hasProcess(repairId)) {
      trace.info('starting repair', {id: repairId});
      missingProcesses++;

      const repairRunnable = new RepairRunnable(this.id);
      this.scheduler.registerProcess(new Process(repairId, 'repair',
        Priorities.CRITICAL, repairRunnable));
    }

    // Observer runnable
    const observerStructures = primaryRoom.find<StructureObserver>(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_OBSERVER;
      },
    });

    if (observerStructures.length) {
      const observerId = observerStructures[0].id;
      const hasProcess = this.scheduler.hasProcess(observerId);
      if (!hasProcess) {
        trace.info('starting observer', {id: observerId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(observerId, 'observer', Priorities.EXPLORATION,
          new ObserverRunnable(base.id, observerStructures[0])));
      }
    }

    this.missingProcesses = missingProcesses;
  }

  requestRepairer(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
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

    const numRepairers = kernel.getCreepsManager().getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_REPAIRER).length;

    trace.info('need repairers?', {id: this.id, hitsPercentage, numRepairers});

    // Repairer requests
    let desiredRepairers = 0;
    let repairerPriority = PRIORITIES.PRIORITY_REPAIRER;
    if (hitsPercentage < 0.8) {
      trace.info('need more repairers', {id: this.id, hitsPercentage});
      desiredRepairers = 1;
    }

    if (hitsPercentage < 0.6) {
      trace.info('need more repairers', {id: this.id, hitsPercentage});
      desiredRepairers = 2;
      repairerPriority = PRIORITIES.PRIORITY_REPAIRER_URGENT;
    }

    if (Game.cpu.bucket < 1000) {
      trace.info('bucket low', {bucket: Game.cpu.bucket});
      desiredRepairers = 0;
    }

    if (numRepairers >= desiredRepairers) {
      trace.info('already have enough repairers', {id: this.id, numRepairers, desiredRepairers});
      return;
    }

    trace.info('request repairers', {id: this.id, desiredRepairers, numRepairers});

    // @TODO create role base creation methods
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
    };

    const request = createSpawnRequest(repairerPriority, REQUEST_REPAIRER_TTL, CREEPS.WORKER_REPAIRER,
      memory, null, 0);
    kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
    // @CONFIRM that repairers are spawning
  }

  requestBuilder(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    if (!Object.values(Game.spawns).length) {
      trace.info('no spawns, dont spawn builders');
      return;
    }

    if (!room.storage) {
      trace.info('no storage, dont spawn builders');
      return;
    }

    const builders = kernel.getCreepsManager().getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_BUILDER);

    const numConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    trace.info('num constructions sites', {numConstructionSites});

    let desiredBuilders = 0;
    if (numConstructionSites) {
      desiredBuilders = desiredBuilders = Math.ceil(numConstructionSites / 10);
    }

    if (desiredBuilders > 3) {
      desiredBuilders = 3;
    }

    trace.info('checking builders', {id: this.id, numConstructionSites, desiredBuilders});

    if (builders.length >= desiredBuilders) {
      trace.info('already have enough builders', {id: this.id, numConstructionSites, desiredBuilders});
      return;
    }

    const priority = PRIORITIES.PRIORITY_BUILDER - (builders.length * 2);
    const ttl = REQUEST_BUILDER_TTL;
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
      [MEMORY.MEMORY_BASE]: base.id,
    };
    const request = createSpawnRequest(priority, ttl, CREEPS.WORKER_BUILDER, memory, null, 0);
    kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
    // @CONFIRM builders are being spawned
  }

  requestUpgrader(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    if (!room.storage) {
      trace.info('no storage, dont spawn upgraders');
      return;
    }

    const numUpgraders = kernel.getCreepsManager().getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_UPGRADER).length;

    let parts = 1;
    let desiredUpgraders = MIN_UPGRADERS;
    let maxParts = 15;

    const reserveEnergy = getStoredResourceAmount(base, RESOURCE_ENERGY);
    const reserveBuffer = getReserveBuffer(base);

    if (!room.controller?.my) {
      trace.error('not my room');
      desiredUpgraders = 0;
    } else if (room.controller.level === 8) {
      parts = (reserveEnergy - reserveBuffer) / 1500;
      desiredUpgraders = 1;

      // In an effort to reduce CPU usage, we only spawn upgraders if they have many parts or
      // if we are close go being downgraded In theory, we will build bigger creeps instead of
      // smaller ones and rate won't be a big reduction
      if (parts < 15 && room.controller.ticksToDowngrade > MIN_TICKS_TO_DOWNGRADE) {
        desiredUpgraders = 0;
      }

      trace.info('max level room', {
        parts, desiredUpgraders, ticksToDowngrade: room.controller.ticksToDowngrade,
        reserveEnergy, reserveBuffer,
      });
    } else if (room.storage) { // @ORG-REFACTOR replace has storage with base phase
      const roomCapacity = room.energyCapacityAvailable;
      maxParts = Math.floor(roomCapacity / 200);
      if (maxParts > 15) {
        maxParts = 15;
      }

      if (room.storage?.isActive() && reserveEnergy > reserveBuffer) {
        parts = (reserveEnergy - reserveBuffer) / 1500;
      } else if (!room.storage && reserveEnergy > 1000) {
        parts = reserveEnergy - 1000 / 1500;
      }

      desiredUpgraders = Math.ceil(parts / maxParts);

      trace.info('has storage', {desiredUpgraders, maxParts, parts, reserveEnergy, reserveBuffer});
    }

    const energyLimit = ((parts - 1) * 150) + 200;

    // Don't let it create a ton of upgraders
    if (desiredUpgraders > MAX_UPGRADERS) {
      desiredUpgraders = MAX_UPGRADERS;
    }

    trace.info('request upgraders', {
      desiredUpgraders,
      numUpgraders,
      parts,
      energyLimit,
    });

    for (let i = 0; i < desiredUpgraders - numUpgraders; i++) {
      // Reduce priority by number of existing and requested upgraders
      const upgraderPriority = PRIORITIES.PRIORITY_UPGRADER - ((numUpgraders + i) * 2);

      const memory = {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_BASE]: base.id,
      };

      const request = createSpawnRequest(upgraderPriority, REQUEST_UPGRADER_TTL,
        CREEPS.WORKER_UPGRADER, memory, null, energyLimit);
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
      // @CONFIRM that upgraders are being created
    }
  }

  requestExplorer(trace: Tracer, kernel: Kernel, base: Base) {
    const shardConfig = kernel.getConfig();
    if (!shardConfig.explorers) {
      trace.info('shard does not allow explorers');
      return;
    }

    const explorers = kernel.getCreepsManager().
      getCreepsByBaseAndRole(this.id, CREEPS.WORKER_EXPLORER);

    if (explorers.length < MAX_EXPLORERS) {
      trace.info('requesting explorer');

      const priority = PRIORITIES.EXPLORER;
      const ttl = REQUEST_EXPLORER_TTL;
      const role = CREEPS.WORKER_EXPLORER;
      const memory = {
        [MEMORY.MEMORY_BASE]: base.id,
      };
      const request = createSpawnRequest(priority, ttl, role, memory, null, 0);
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
    } else {
      trace.info('not requesting explorer', {numExplorers: explorers.length});
    }
  }

  updateRampartAccess(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const message = kernel.getTopics().peekNextRequest(TOPICS.DEFENSE_STATUSES);
    if (!message) {
      trace.info('did not find a defense status, fail closed');
      this.setRamparts(room, DEFENSE_POSTURE.CLOSED, trace);
      return;
    }

    const status = message.details.status;
    const isPublic = base.isPublic;

    trace.info('rampart access', {status, isPublic, posture: this.defensePosture});

    if ((!isPublic || status !== DEFENSE_STATUS.GREEN) && this.defensePosture !== DEFENSE_POSTURE.CLOSED) {
      trace.notice('setting ramparts closed');
      this.setRamparts(room, DEFENSE_POSTURE.CLOSED, trace);
    }

    if (status === DEFENSE_STATUS.GREEN && isPublic && this.defensePosture !== DEFENSE_POSTURE.OPEN) {
      trace.notice('setting ramparts open');
      this.setRamparts(room, DEFENSE_POSTURE.OPEN, trace);
    }
  }

  setRamparts(room: Room, posture: DEFENSE_POSTURE, _trace: Tracer) {
    const isPublic = posture === DEFENSE_POSTURE.OPEN;
    // Close all ramparts
    room.find<StructureRampart>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_RAMPART;
      },
    }).forEach((rampart) => {
      rampart.setPublic(isPublic);
    });
    this.defensePosture = posture;
  }

  checkSafeMode(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const controller = room.controller;
    if (!controller) {
      trace.info('controller not found');
      return;
    }

    let enableSafeMode = false;

    let hostiles = room.find(FIND_HOSTILE_CREEPS);
    // filter out hostiles without attack, ranged attack, or work parts
    hostiles = hostiles.filter((hostile) => {
      return hostile.getActiveBodyparts(ATTACK) ||
        hostile.getActiveBodyparts(RANGED_ATTACK) ||
        hostile.getActiveBodyparts(WORK);
    });

    // Filter friendly creeps
    const friends = kernel.getFriends();
    hostiles = hostiles.filter((creep) => friends.indexOf(creep.owner.username) === -1);

    if (hostiles) {
      // BUG: Proximity to a link has triggered safe mode
      // find may not work as expected
      const infrastructure = room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return _.find(importantStructures, structure.structureType);
        },
      });

      // Iterate through critical infrastructure and check if any are under attack
      for (const structure of infrastructure) {
        if (structure.pos.findInRange(hostiles, 3).length) {
          trace.notice('critical infrastructure under attack');
          enableSafeMode = true;
          break;
        }
      }
    }

    if (enableSafeMode) {
      if (controller.safeMode) {
        trace.info('safe mode already active');
        return;
      }

      // If hostiles present spawn defenders and/or activate safe mode
      if (controller.safeModeAvailable && !controller.safeMode && !controller.safeModeCooldown) {
        controller.activateSafeMode();
        trace.warn('activating safe mode');
        return;
      }
    } else {
      trace.info('do not enable safe mode');
    }
  }

  requestEnergy(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const terminalEnergy = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
    const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

    trace.info('room energy', {
      terminalEnergy,
      storageEnergy,
      roomLevel: getBaseLevel(base),
      desiredBuffer: getReserveBuffer(base),
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
      trace.info('requesting energy from governor', {amount, resource: RESOURCE_ENERGY});

      const resourceGovernor = kernel.getResourceManager();
      const requested = resourceGovernor.requestResource(base, RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
      if (!requested) {
        resourceGovernor.buyResource(base, RESOURCE_ENERGY, amount, ENERGY_REQUEST_TTL, trace);
      }
    }
  }

  produceStatus(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const resources = getStoredResources(base);

    const roomStatus: BaseStatus = {
      [MEMORY.BASE_STATUS_NAME]: room.name,
      [MEMORY.BASE_STATUS_LEVEL]: getBaseLevel(base),
      [MEMORY.BASE_STATUS_LEVEL_COMPLETED]: getBaseLevelCompleted(base),
      [MEMORY.BASE_STATUS_TERMINAL]: !!room.terminal,
      [MEMORY.BASE_STATUS_ENERGY]: resources.get(RESOURCE_ENERGY) || 0,
      [MEMORY.BASE_STATUS_ALERT_LEVEL]: base.alertLevel,
    };

    const status = {
      details: roomStatus,
    };

    trace.info('producing room status', {status});

    kernel.getTopics().addRequest(TOPICS.ROOM_STATUES, 1, status, PRODUCE_STATUS_TTL);

    const line: HudLine = {
      key: `base_${base.id}`,
      room: room.name,
      order: 0,
      text: `Base: ${base.id} - status: ${base.alertLevel}, level: ${getBaseLevel(base)}, ` +
        `Rooms: ${base.rooms.join(',')}  `,
      time: Game.time,
    };
    const event = new Event(room.name, Game.time, HudEventSet, line);
    kernel.getBroker().getStream(getLinesStream()).publish(event);

    const reserveEnergy = getStoredResourceAmount(base, RESOURCE_ENERGY);
    const reserveBuffer = getReserveBuffer(base);
    const parts = (reserveEnergy - reserveBuffer) / 1500;

    const upgraderLine: HudLine = {
      key: `base_${base.id}_upgrader`,
      room: room.name,
      order: 1,
      text: `Energy: ${reserveEnergy}, Buffer: ${reserveBuffer}, Parts: ${parts}`,
      time: Game.time,
    };
    const upgraderEvent = new Event(room.name, Game.time, HudEventSet, upgraderLine);
    kernel.getBroker().getStream(getLinesStream()).publish(upgraderEvent);

    const indicatorStream = kernel.getBroker().getStream(getDashboardStream());

    base.rooms.forEach((roomName) => {
      // Alert indicator
      let alertLevelStatus = HudIndicatorStatus.Green;
      if (base.alertLevel === AlertLevel.RED) {
        alertLevelStatus = HudIndicatorStatus.Red;
      } else if (base.alertLevel === AlertLevel.YELLOW) {
        alertLevelStatus = HudIndicatorStatus.Yellow;
      }
      const alertLevelIndicator: HudIndicator = {
        room: roomName, key: 'alert', display: 'A',
        status: alertLevelStatus,
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
      room: room.name, key: 'processes', display: 'P',
      status: processStatus,
    };
    indicatorStream.publish(new Event(base.id, Game.time, HudEventSet, keyProcessesIndicator));
  }

  updateAlertLevel(trace: Tracer, kernel: Kernel, base: Base, _room: Room) {
    // check if strong enemies are present in base
    const roomEntry = kernel.getScribe().getRoomById(base.primary);
    if (!roomEntry) {
      trace.warn('room not found, assuming hostile presence', {room: base.primary});
      base.alertLevel = AlertLevel.YELLOW;
      return;
    }

    if (beingSieged(roomEntry)) {
      trace.warn('room being sieged', {
        room: base.primary,
        hostileDamage: roomEntry.hostilesDmg,
        hostileHealing: roomEntry.hostilesHealing,
      });
      base.alertLevel = AlertLevel.RED;
      return;
    }

    // check if strong enemies are present in rooms
    const rooms = base.rooms;
    const hostileRoom = rooms.find((roomName) => {
      const roomEntry = kernel.getScribe().getRoomById(roomName);
      if (!roomEntry) {
        trace.info('room not found', {room: roomName});
        return false;
      }

      if (beingSieged(roomEntry)) {
        return true;
      }

      return false;
    });

    if (hostileRoom) {
      trace.warn('hostile presence detected', {
        room: hostileRoom,
      });
      base.alertLevel = AlertLevel.YELLOW;
      return;
    }

    // check if neighbor is under red alert
    const neighbors = base.neighbors;
    const redNeighbor = neighbors.find((id) => {
      const neighborBase = kernel.getPlanner().getBaseById(id);
      if (!neighborBase) {
        trace.warn('neighbor base not found, should not happen', {id});
        return false;
      }

      if (neighborBase.alertLevel === AlertLevel.RED) {
        return true;
      }

      return false;
    });

    if (redNeighbor) {
      trace.warn('red neighbor detected', {
        redNeighbor,
      });
      base.alertLevel = AlertLevel.YELLOW;
      return;
    }

    trace.info('no significant hostile presence', {level: base.alertLevel, baseId: base.id});
    base.alertLevel = AlertLevel.GREEN;
  }

  updateBoosters(trace: Tracer, kernel: Kernel, base: Base) {
    const topic = kernel.getTopics().getTopic(getBaseBoostTopic(base));
    if (!topic) {
      trace.info('no topic', {room: this.id});
      return;
    }

    topic.forEach((event) => {
      const details: BoosterDetails = event.details;
      trace.info('booster position', {room: this.id, details});
      setBoostPosition(base, details.position);
      setLabsByAction(base, details.labsByAction);
      base.storedEffects = details.storedEffects;
      base.labsByAction = details.labsByAction;
    });
  }
}

function beingSieged(roomEntry: RoomEntry) {
  if (roomEntry.hostilesDmg > HOSTILE_DAMAGE_THRESHOLD ||
    roomEntry.hostilesHealing > HOSTILE_HEALING_THRESHOLD) {
    return true;
  }

  return false;
}
