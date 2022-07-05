import {AlertLevel, Base, getBasePrimaryRoom, setBoostPosition, setLabsByAction} from './base';
import * as CREEPS from './constants.creeps';
import {DEFENSE_STATUS} from './constants.defense';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import {Kernel} from './kernel';
import {Event} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {Process, sleeping, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from './os.thread';
import {scoreAttacking} from './role.harasser';
import {BoosterDetails, TOPIC_ROOM_BOOSTS} from './runnable.base_booster';
import BaseConstructionRunnable from "./runnable.base_construction";
import ControllerRunnable from './runnable.base_controller';
import {LabsManager} from "./runnable.base_labs";
import LinkManager from "./runnable.base_links";
import LogisticsRunnable from './runnable.base_logistics';
import NukerRunnable from "./runnable.base_nuker";
import ObserverRunnable from './runnable.base_observer';
import RoomRunnable from './runnable.base_room';
import SpawnManager, {createSpawnRequest, getBaseSpawnTopic, getShardSpawnTopic} from "./runnable.base_spawning";
import TerminalRunnable from "./runnable.base_terminal";
import TowerRunnable from "./runnable.base_tower";
import {getDashboardStream, getLinesStream, HudEventSet, HudIndicator, HudIndicatorStatus, HudLine} from './runnable.debug_hud';
import {RoomEntry} from './runnable.scribe';

const MIN_ENERGY = 100000;
const MIN_TICKS_TO_DOWNGRADE = 150000;

const MIN_UPGRADERS = 1;
const MAX_UPGRADERS = 10;
const UPGRADER_ENERGY = 25000;
const MIN_DISTRIBUTORS = 1;
const MAX_EXPLORERS = 3;

const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const ENERGY_REQUEST_TTL = 50;
const REQUEST_CLAIMER_TTL = 50;
const REQUEST_REPAIRER_TTL = 30;
const REQUEST_BUILDER_TTL = 30;
const REQUEST_DISTRIBUTOR_TTL = 10;
const REQUEST_UPGRADER_TTL = 30;
const CHECK_SAFE_MODE_TTL = 10;
const HAUL_EXTENSION_TTL = 10;
const RAMPART_ACCESS_TTL = 10;
const UPDATE_PROCESSES_TTL = 20;
const PRODUCE_STATUS_TTL = 30;
const ABANDON_BASE_TTL = 50;
const REQUEST_EXPLORER_TTL = 200;
const UPDATE_BOOSTER_TTL = 5;

const MIN_HOSTILE_ATTACK_SCORE_TO_ABANDON = 3000;
const HOSTILE_DAMAGE_THRESHOLD = 0;
const HOSTILE_HEALING_THRESHOLD = 600;

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
  threadRequestExplorer: ThreadFunc;

  threadUpdateBoosters: ThreadFunc;
  threadCheckSafeMode: ThreadFunc;
  threadRequestExtensionFilling: ThreadFunc;
  //threadUpdateRampartAccess: ThreadFunc;
  threadRequestEnergy: ThreadFunc;
  threadProduceStatus: ThreadFunc;
  threadAbandonBase: ThreadFunc;
  threadUpdateAlertLevel: ThreadFunc;


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
    this.threadRequestExplorer = thread('request_explorers_thread', REQUEST_EXPLORER_TTL)(this.requestExplorer.bind(this))

    this.threadCheckSafeMode = thread('check_safe_mode_thread', CHECK_SAFE_MODE_TTL)(this.checkSafeMode.bind(this));
    this.threadRequestExtensionFilling = thread('request_extension_filling_thread', HAUL_EXTENSION_TTL)(this.requestExtensionFilling.bind(this));
    //this.threadUpdateRampartAccess = thread('update_rampart_access_thread', RAMPART_ACCESS_TTL)(this.updateRampartAccess.bind(this));
    this.threadRequestEnergy = thread('request_energy_thread', ENERGY_REQUEST_TTL)(this.requestEnergy.bind(this));
    this.threadProduceStatus = thread('produce_status_thread', PRODUCE_STATUS_TTL)(this.produceStatus.bind(this));
    this.threadAbandonBase = thread('abandon_base_check', ABANDON_BASE_TTL)(this.abandonBase.bind(this));
    this.threadUpdateAlertLevel = thread('update_alert_level_thread', UPDATE_PROCESSES_TTL)(this.updateAlertLevel.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');

    trace.log('room run', {
      id: this.id,
    });

    const base = kernel.getPlanner().getBaseByRoom(this.id);
    if (!base) {
      trace.error("no colony config, terminating", {id: this.id})
      trace.end();
      return terminate();
    }

    // if room not visible, request room be claimed
    const room = Game.rooms[this.id];
    if (!room || room.controller?.level === 0) {
      trace.notice('cannot see room or level 0', {id: this.id});
      this.requestClaimer(kernel, trace);
      trace.end();
      return sleeping(NO_VISION_TTL);
    }

    // TODO try to remove dependency on OrgRoom
    const orgRoom = getBasePrimaryRoom(base);
    if (!orgRoom) {
      trace.error("no org room, terminating", {id: this.id})
      trace.end();
      return sleeping(NO_VISION_TTL);
    }

    this.threadUpdateProcessSpawning(trace, base, orgRoom, room);

    // Pump events from booster runnable and set booster state on the Base
    this.threadUpdateBoosters = thread('update_booster_thread', UPDATE_BOOSTER_TTL)((trace, room, kernel) => {
      const topic = kernel.getTopics().getTopic(TOPIC_ROOM_BOOSTS);
      if (!topic) {
        trace.log('no topic', {room: this.id});
        return;
      }

      topic.forEach((event) => {
        const details: BoosterDetails = event.details;
        trace.log('booster position', {room: this.id, details});
        setBoostPosition(base, details.position);
        setLabsByAction(base, details.labsByAction);
      });
    });

    // Base life cycle
    this.threadAbandonBase(trace, kernel, base, room);

    // Defense
    // this.threadUpdateRampartAccess(trace, orgRoom, room);
    this.threadCheckSafeMode(trace, kernel, room);

    // Logistics
    this.threadRequestEnergy(trace, orgRoom, room);
    this.threadRequestExtensionFilling(trace, kernel, orgRoom, room);

    // Creeps
    this.threadRequestUpgrader(trace, kernel, base, orgRoom, room);
    this.threadRequestDistributor(trace, kernel, base, orgRoom, room);
    if (base.alertLevel === AlertLevel.GREEN) {
      this.threadRequestBuilder(trace, kernel, base, orgRoom, room);
      this.threadRequestRepairer(trace, kernel, base, orgRoom, room);
      this.threadRequestExplorer(trace, kernel, base, orgRoom, room);
    }

    // Inform other processes of room status
    this.threadProduceStatus(trace, kernel, orgRoom, base);

    // Alert level
    this.threadUpdateAlertLevel(trace, base, kernel);

    const roomVisual = new RoomVisual(this.id);
    roomVisual.text("O", base.origin.x, base.origin.y, {color: '#FFFFFF'});
    roomVisual.text("P", base.parking.x, base.parking.y, {color: '#FFFFFF'});

    trace.end();
    return sleeping(MIN_TTL);
  }

  abandonBase(trace: Tracer, kernel: Kernel, base: Base, room: Room): void {
    trace = trace.begin('abandon_base');

    trace.info('abandoning base check', {
      id: this.id,
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

    //kernel.getPlanner().removeBase(base.id, trace);

    trace.end();
  }

  requestClaimer(kernel: Kernel, trace: Tracer) {
    const enroute = _.find(Game.creeps, {
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_RESERVER,
        [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
        [MEMORY.MEMORY_BASE]: this.id,
      }
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

  handleProcessSpawning(trace: Tracer, base: Base, room: Room) {
    let missingProcesses = 0;

    // Spawn Manager
    const spawnManagerId = `spawns_${this.id}`;
    if (!this.scheduler.hasProcess(spawnManagerId)) {
      trace.log('starting spawn manager', {id: this.id});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(spawnManagerId, 'spawns', Priorities.CORE_LOGISTICS,
        new SpawnManager(spawnManagerId, base.id)));
    }

    // Towers
    room.find<StructureTower>(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_TOWER && structure.isActive();
      },
    }).forEach((tower) => {
      const towerId = `${tower.id}`
      if (!this.scheduler.hasProcess(towerId)) {
        trace.log('starting tower', {id: tower.id});
        missingProcesses++;

        const process = new Process(towerId, 'towers', Priorities.DEFENCE,
          new TowerRunnable(this.id, orgRoom, tower))
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
          new NukerRunnable(this.id, orgRoom, nuker)));
      }
    });

    if (room.terminal?.isActive()) {
      // Terminal runnable
      const terminalId = room.terminal.id;
      if (!this.scheduler.hasProcess(terminalId)) {
        trace.log('starting terminal', {id: terminalId});
        missingProcesses++;

        this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.DEFENCE,
          new TerminalRunnable(this.id, orgRoom, room.terminal)));
      }
    }

    // Link Manager
    const linkManagerId = `links_${this.id}`
    if (!this.scheduler.hasProcess(linkManagerId) && orgRoom.room.storage) {
      trace.log('starting link manager', {id: linkManagerId});
      missingProcesses++;

      this.scheduler.registerProcess(new Process(linkManagerId, 'links', Priorities.RESOURCES,
        new LinkManager(linkManagerId, this.id, orgRoom)));
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
      this.scheduler.registerProcess(new Process(controllerProcessId, 'controller',
        Priorities.CRITICAL, controllerRunnable));
    }

    // Rooms
    base.rooms.forEach((room) => {
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

  requestRepairer(trace: Tracer, kernel: Kernel, base: Base, orgRoom: OrgRoom, room: Room) {
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

    const numRepairers = kernel.creepManager.getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_REPAIRER).length;

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

    // @TODO create role base creation methods
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
    };

    const request = createSpawnRequest(repairerPriority, REQUEST_REPAIRER_TTL, CREEPS.WORKER_REPAIRER,
      memory, 0)
    requestSpawn(kernel, getBaseSpawnTopic(base.id), request)
    // @CONFIRM that repairers are spawning
  }

  requestBuilder(trace: Tracer, kernel: Kernel, base: Base, orgRoom: OrgRoom, room: Room) {
    if (!Object.values(Game.spawns).length) {
      trace.log('no spawns, dont spawn builders');
      return;
    }

    if (!room.storage) {
      trace.log('no storage, dont spawn builders');
      return;
    }

    const builders = kernel.creepManager.getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_BUILDER);

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

    const priority = PRIORITIES.PRIORITY_BUILDER - (builders.length * 2);
    const ttl = REQUEST_BUILDER_TTL;
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      [MEMORY.MEMORY_ASSIGN_SHARD]: Game.shard.name,
      [MEMORY.MEMORY_BASE]: (orgRoom as any).getColony().id,
    };
    const request = createSpawnRequest(priority, ttl, CREEPS.WORKER_BUILDER, memory, 0);
    requestSpawn(kernel, getBaseSpawnTopic(base.id), request);
    // @CONFIRM builders are being spawned
  }

  requestDistributor(trace: Tracer, kernel: Kernel, base: Base, orgRoom: OrgRoom,
    room: Room) {

    const numDistributors = kernel.creepManager.getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_DISTRIBUTOR).length;

    // If low on bucket base not under threat
    if (Game.cpu.bucket < 1000 && numDistributors > 0 && base.alertLevel === AlertLevel.GREEN) {
      trace.log('low CPU, limit distributors');
      return;
    }

    let distributorRequests: number[] = [];

    let desiredDistributors = MIN_DISTRIBUTORS;
    if (room.controller.level < 3) {
      distributorRequests.push(1);
    }

    const fullness = room.energyAvailable / room.energyCapacityAvailable;
    if (room.controller.level >= 3 && fullness < 0.5) {
      distributorRequests.push(3);
    }

    const numCoreHaulTasks = kernel.getTopicLength(getBaseDistributorTopic(this.id));
    if (numCoreHaulTasks > 30) {
      distributorRequests.push(2);
    }
    if (numCoreHaulTasks > 50) {
      distributorRequests.push(3);
    }

    if (base.alertLevel !== AlertLevel.GREEN) {
      distributorRequests.push(3);
    }

    if (orgRoom.numHostiles) {
      const numTowers = room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_TOWER;
        }
      }).length;

      trace.log('hostiles in room and we need more distributors', {numTowers, desiredDistributors});
      distributorRequests.push((numTowers / 2) + desiredDistributors);
    }

    if (!orgRoom.hasStorage || numDistributors >= _.max(distributorRequests)) {
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

    if (numDistributors === 0) {
      distributorPriority += 10;
    }

    const priority = distributorPriority;
    const ttl = REQUEST_DISTRIBUTOR_TTL;
    const role = CREEPS.WORKER_DISTRIBUTOR;
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      [MEMORY.MEMORY_BASE]: base.id,
    };

    const request = createSpawnRequest(priority, ttl, role, memory, 0);
    trace.log('request distributor', {desiredDistributors, fullness, request});
    requestSpawn(kernel, getBaseSpawnTopic(base.id), request);
    // @CHECK that distributors are being spawned
  }

  requestUpgrader(trace: Tracer, kernel: Kernel, base: Base, orgRoom: OrgRoom, room: Room) {
    if (!orgRoom.isPrimary) {
      trace.error('not primary room', {id: this.id, orgRoomid: orgRoom.id});
      return;
    }

    if (!room.storage) {
      trace.log('no storage, dont spawn upgraders');
      return;
    }

    const numUpgraders = kernel.creepManager.getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_UPGRADER).length;

    let parts = 1;
    let desiredUpgraders = MIN_UPGRADERS;
    let maxParts = 15;

    const reserveEnergy = orgRoom.getAmountInReserve(RESOURCE_ENERGY);
    const reserveBuffer = orgRoom.getReserveBuffer();

    if (!room.controller?.my) {
      trace.error('not my room')
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

      trace.log('max level room', {
        parts, desiredUpgraders, ticksToDowngrade: room.controller.ticksToDowngrade,
        reserveEnergy, reserveBuffer
      });
    } else if (orgRoom.hasStorage) { // @ORG-REFACTOR replace has storage with base phase
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

      trace.log('has storage', {desiredUpgraders, maxParts, parts, reserveEnergy, reserveBuffer});
    }

    const energyLimit = ((parts - 1) * 150) + 200;

    // Don't let it create a ton of upgraders
    if (desiredUpgraders > MAX_UPGRADERS) {
      desiredUpgraders = MAX_UPGRADERS;
    }

    trace.log('request upgraders', {
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
        CREEPS.WORKER_UPGRADER, memory, energyLimit);
      requestSpawn(kernel, getBaseSpawnTopic(base.id), request);
      // @CONFIRM that upgraders are being created
    }
  }

  requestExplorer(trace: Tracer, kernel: Kernel, base: Base) {
    const shardConfig = kernel.config;
    if (!shardConfig.explorers) {
      trace.log('shard does not allow explorers');
      return;
    }

    const explorers = kernel.creepManager.getCreepsByBaseAndRole(this.id,
      CREEPS.WORKER_EXPLORER);

    if (explorers.length < MAX_EXPLORERS) {
      trace.log('requesting explorer');

      const priority = PRIORITIES.EXPLORER;
      const ttl = REQUEST_EXPLORER_TTL;
      const role = CREEPS.WORKER_EXPLORER;
      const memory = {
        [MEMORY.MEMORY_BASE]: base.id,
      };
      const request = createSpawnRequest(priority, ttl, role, memory, 0);
      requestSpawn(kernel, getBaseSpawnTopic(base.id), request);
      // @CONFIRM that explorers spawns
    } else {
      trace.log('not requesting explorer', {numExplorers: explorers.length});
    }
  }

  requestExtensionFilling(trace: Tracer, kernel: Kernel, orgRoom: OrgRoom, room: Room) {
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

      kernel.sendRequest(getBaseDistributorTopic(this.id), PRIORITIES.HAUL_EXTENSION,
        details, HAUL_EXTENSION_TTL);
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

  checkSafeMode(trace: Tracer, kernel: Kernel, room: Room) {
    const controller = room.controller;
    if (!controller) {
      trace.log('controller not found');
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
    const friends = kernel.config.friends;
    hostiles = hostiles.filter(creep => friends.indexOf(creep.owner.username) === -1);

    if (hostiles) {
      const infrastructure = room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return _.find(importantStructures, structure.structureType);
        }
      });

      // Iterate through critical infrastructure and check if any are under attack
      for (const structure of infrastructure) {
        if (structure.pos.findInRange(hostiles, 4).length) {
          trace.notice('critical infrastructure under attack');
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
        trace.warn('activating safe mode');
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

  produceStatus(trace: Tracer, kernel: Kernel, orgRoom: OrgRoom, base: Base) {
    const resources = orgRoom.getReserveResources();

    const status = {
      details: {
        [MEMORY.ROOM_STATUS_NAME]: orgRoom.id,
        [MEMORY.ROOM_STATUS_LEVEL]: orgRoom.getRoomLevel(),
        [MEMORY.ROOM_STATUS_LEVEL_COMPLETED]: orgRoom.getRoomLevelCompleted(),
        [MEMORY.ROOM_STATUS_TERMINAL]: orgRoom.hasTerminal(),
        [MEMORY.ROOM_STATUS_ENERGY]: resources[RESOURCE_ENERGY] || 0,
        [MEMORY.ROOM_STATUS_ALERT_LEVEL]: base.alertLevel,
      },
    }

    trace.log('producing room status', {status});

    orgRoom.getKingdom().sendRequest(TOPICS.ROOM_STATUES, 1, status, PRODUCE_STATUS_TTL);

    const line: HudLine = {
      key: `base_${orgRoom.id}`,
      room: orgRoom.id,
      order: 0,
      text: `Base: ${orgRoom.id} - status: ${base.alertLevel}, level: ${orgRoom.getRoomLevel()}, ` +
        `Rooms: ${base.rooms.join(',')}  `,
      time: Game.time,
    };
    const event = new Event(orgRoom.id, Game.time, HudEventSet, line);
    orgRoom.getKingdom().getBroker().getStream(getLinesStream()).publish(event);

    const reserveEnergy = orgRoom.getAmountInReserve(RESOURCE_ENERGY);
    const reserveBuffer = orgRoom.getReserveBuffer();
    const parts = (reserveEnergy - reserveBuffer) / 1500;

    const upgraderLine: HudLine = {
      key: `base_${orgRoom.id}_upgrader`,
      room: orgRoom.id,
      order: 1,
      text: `Energy: ${reserveEnergy}, Buffer: ${reserveBuffer}, Parts: ${parts}`,
      time: Game.time,
    };
    const upgraderEvent = new Event(orgRoom.id, Game.time, HudEventSet, upgraderLine);
    orgRoom.getKingdom().getBroker().getStream(getLinesStream()).publish(upgraderEvent);

    const indicatorStream = orgRoom.getKingdom().getBroker().getStream(getDashboardStream())

    base.rooms.forEach((roomName) => {
      const orgRoom = kernel.getRoomByName(roomName);
      if (!orgRoom) {
        trace.warn('room not found', {roomName});
        return;
      }

      // Alert indicator
      let alertLevelStatus = HudIndicatorStatus.Green;
      if (base.alertLevel === AlertLevel.RED) {
        alertLevelStatus = HudIndicatorStatus.Red;
      } else if (base.alertLevel === AlertLevel.YELLOW) {
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
    indicatorStream.publish(new Event(base.id, Game.time, HudEventSet, keyProcessesIndicator));
  }

  updateAlertLevel(trace: Tracer, base: Base, kernel: Kernel) {
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
    let hostileRoom = rooms.find((roomName) => {
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

    trace.notice('no significant hostile presence', {level: base.alertLevel});
    base.alertLevel = AlertLevel.GREEN;
  }
}

function beingSieged(roomEntry: RoomEntry) {
  if (roomEntry.hostilesDmg > HOSTILE_DAMAGE_THRESHOLD ||
    roomEntry.hostilesHealing > HOSTILE_HEALING_THRESHOLD) {
    return true;
  }

  return false;
}
