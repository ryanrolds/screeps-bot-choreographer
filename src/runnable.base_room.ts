import {creepIsFresh} from './behavior.commute';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import {Event} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom, {AlertLevel} from "./org.room";
import {Process, sleeping, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from './os.thread';
import {getLinesStream, HudLine, HudEventSet} from './runnable.debug_hud';
import SourceRunnable from "./runnable.base_room_source";
import MineralRunnable from './runnable.base_room_mineral';
import {BaseConfig} from './config';
import {getBaseSpawnTopic, getBaseHaulerTopic} from './topics.base';
import {getKingdomSpawnTopic} from './topics.kingdom';
import {PersistentMemory} from './os.memory';
import {BaseDefenseStatusSet, getBaseRoomStatusStream, RoomCreepScore as CreepScore, RoomDefenseStatus} from './runnable.base_defense';

const MIN_RESERVATION_TICKS = 4000;
const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const REQUEST_RESERVER_TTL = 50;
const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 30;
const UPDATE_PROCESSES_TTL = 50;
const PRODUCE_STATUS_TTL = 25;

const MEMORY_HOSTILE_TIME = 'hostile_time';
const MEMORY_HOSTILE_POS = 'hostile_pos';

const MAX_DEFENDERS = 8;

export default class RoomRunnable extends PersistentMemory {
  id: string;
  baseId: string;
  roomName: string;
  scheduler: Scheduler;

  alertLevel: AlertLevel;

  threadUpdateProcessSpawning: ThreadFunc;
  threadRequestReservers: ThreadFunc;
  threadRequestHaulDroppedResources: ThreadFunc;
  threadRequestHaulTombstones: ThreadFunc;
  threadProduceStatuses: ThreadFunc;

  constructor(id: string, baseId: string, roomName: string, scheduler: Scheduler) {
    super(id);

    this.id = id;
    this.baseId = baseId;
    this.roomName = roomName;
    this.scheduler = scheduler;

    this.alertLevel = AlertLevel.GREEN;

    // Threads
    this.threadUpdateProcessSpawning = thread('spawn_room_processes_thread',
      UPDATE_PROCESSES_TTL)(this.handleProcessSpawning.bind(this));
    this.threadRequestReservers = thread('request_reserver_thread',
      REQUEST_RESERVER_TTL)(this.requestReservers.bind(this));
    this.threadRequestHaulDroppedResources = thread('request_haul_dropped_thread',
      REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulDroppedResources.bind(this));
    this.threadRequestHaulTombstones = thread('request_haul_tombstone_thread',
      REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulTombstones.bind(this));
    this.threadProduceStatuses = thread('produce_status_thread',
      PRODUCE_STATUS_TTL)((trace, kingdom, base, orgRoom, room) => {
        this.produceStatus(trace, orgRoom);
        this.produceDefenseStatus(trace, kingdom, base, room);
      });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');
    trace = trace.withFields({roomName: this.roomName});

    trace.log('room run');

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(this.roomName);
    if (!baseConfig) {
      trace.error("no colony config, terminating");
      trace.end();
      return terminate();
    }

    trace = trace.withFields({baseId: baseConfig.id});

    // Do not request reservers for primary room
    if (this.roomName !== baseConfig.primary) {
      this.threadRequestReservers(trace, kingdom, baseConfig);
    }

    // TODO try to remove dependency on OrgRoom
    const orgRoom = kingdom.getRoomByName(this.roomName);
    if (!orgRoom) {
      trace.error("no org room, terminating")
      trace.end();
      return terminate();
    }

    const room = Game.rooms[this.roomName];
    if (!room) {
      trace.notice('cannot find room in game');
      return sleeping(NO_VISION_TTL);
    }

    this.threadUpdateProcessSpawning(trace, this.baseId, orgRoom, room);
    this.threadRequestHaulDroppedResources(trace, kingdom, baseConfig, orgRoom, room);
    this.threadRequestHaulTombstones(trace, kingdom, baseConfig, orgRoom, room);
    this.threadProduceStatuses(trace, kingdom, baseConfig, orgRoom, room);

    trace.end();
    return sleeping(MIN_TTL);
  }

  handleProcessSpawning(trace: Tracer, baseId: string, orgRoom: OrgRoom, room: Room) {
    if (room.controller?.my || !room.controller?.owner?.username) {
      // Sources
      room.find(FIND_SOURCES).forEach((source) => {
        const sourceId = `${source.id}`
        if (!this.scheduler.hasProcess(sourceId)) {
          trace.log("found source without process, starting", {sourceId: source.id, room: this.roomName});
          this.scheduler.registerProcess(new Process(sourceId, 'sources', Priorities.RESOURCES,
            new SourceRunnable(baseId, room.name, orgRoom, source)));
        }
      });

      if (orgRoom.isPrimary && orgRoom.getRoomLevel() >= 6) {
        // Mineral
        room.find(FIND_MINERALS).forEach((mineral) => {
          const mineralId = `${mineral.id}`
          if (!this.scheduler.hasProcess(mineralId)) {
            this.scheduler.registerProcess(new Process(mineralId, 'mineral', Priorities.RESOURCES,
              new MineralRunnable(baseId, orgRoom, mineral)));
          }
        });
      }
    }
  }

  requestReservers(trace: Tracer, kingdom: Kingdom, base: BaseConfig) {
    if (this.alertLevel !== AlertLevel.GREEN) {
      trace.warn('not requesting reserver, not green');
      return;
    }

    const numReservers = _.filter(Game.creeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_RESERVER) &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === this.roomName && creepIsFresh(creep);
    }).length;

    if (numReservers) {
      return;
    }

    // If no visibility then request explorer || not enough energy
    const room = Game.rooms[this.roomName];
    if (!room) {
      trace.warn('room not visible');
    }

    let reservationTicks = 0;
    if (room?.controller?.reservation) {
      reservationTicks = room.controller.reservation.ticksToEnd;
    }

    const claimedByMe = room?.controller?.my || false;
    let reservedByMe = false;

    if (room) {
      const username = kingdom.getPlanner().getUsername()
      const reservedBy = _.get(room, 'controller.reservation.username', null);
      if (reservedBy === username) {
        reservedByMe = true;
      }
    }

    trace.log('deciding to request reserver', {
      numReservers: numReservers,
      ownedByMe: (reservedByMe || claimedByMe),
      alertLevel: this.alertLevel,
      reservationTicks: (reservedByMe && reservationTicks) ?
        reservationTicks < MIN_RESERVATION_TICKS : false,
    });

    const notOwned = !reservedByMe && !claimedByMe;

    const primaryRoom = Game.rooms[base.primary];
    trace.log('primary room', {
      notOwned,
      primaryRoom: primaryRoom,
      energyCapacityAvailable: primaryRoom?.energyCapacityAvailable
    });

    if (notOwned && (primaryRoom?.energyCapacityAvailable || 0) < 800) {
      const numExplorers = _.filter(Game.creeps, (creep) => {
        return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_EXPLORER &&
          creep.memory[MEMORY.MEMORY_BASE] === this.baseId
      }).length;

      // Limit bases to 3 explorers
      if (numExplorers > 3) {
        trace.log('explorer already requested', {numExplorers});
        return;
      }

      trace.warn('requesting explorer because we cant build reservers');

      this.requestExplorer(kingdom, trace);
      return;
    }

    const reservedByMeAndEndingSoon = reservedByMe && reservationTicks < MIN_RESERVATION_TICKS;
    if (notOwned || reservedByMeAndEndingSoon) {
      this.requestReserver(kingdom, trace);
      return;
    }
  }

  requestExplorer(kingdom: Kingdom, trace: Tracer) {
    trace.log('sending explorer request to colony');

    const details = {
      [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_EXPLORER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.roomName,
        [MEMORY.MEMORY_BASE]: this.baseId,
      },
    };

    let topic = getBaseSpawnTopic(this.baseId);
    // Intentionally using the higher priority of reservers for the explorer
    kingdom.sendRequest(topic, PRIORITIES.PRIORITY_RESERVER, details, REQUEST_RESERVER_TTL);
  }

  requestReserver(kingdom: Kingdom, trace: Tracer) {
    trace.log('sending reserve request to colony');

    const details = {
      role: CREEPS.WORKER_RESERVER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: this.roomName,
        [MEMORY.MEMORY_BASE]: this.baseId,
      },
    }

    let topic = getBaseSpawnTopic(this.baseId);
    kingdom.sendRequest(topic, PRIORITIES.PRIORITY_RESERVER, details, REQUEST_RESERVER_TTL);
  }

  requestHaulDroppedResources(trace: Tracer, kingdom: Kingdom, base: BaseConfig,
    orgRoom: OrgRoom, room: Room) {
    if (this.alertLevel !== AlertLevel.GREEN) {
      trace.warn('not requesting haul dropped resources, not green');
      return;
    }

    // Get resources to haul
    let droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES);

    // No resources to haul, we are done
    if (!droppedResourcesToHaul.length) {
      trace.log('no dropped resources');
      return;
    }

    const primaryRoom = orgRoom.getColony().getPrimaryRoom();
    const haulers = orgRoom.getColony().getHaulers();
    const avgHaulerCapacity = orgRoom.getColony().getAvgHaulerCapacity();

    trace.log('avg hauler capacity', {numHaulers: haulers.length, avgHaulerCapacity});

    droppedResourcesToHaul.forEach((resource) => {
      const topic = getBaseHaulerTopic(base.id);
      let priority = PRIORITIES.HAUL_DROPPED;

      // Increase priority if primary room
      // TODO factor distance (or number of rooms from base)
      if (orgRoom.getColony().primaryRoomId === resource.room.name) {
        priority += PRIORITIES.HAUL_BASE_ROOM;
      }

      if (room.storage?.pos.isNearTo(resource.pos)) {
        priority += PRIORITIES.DUMP_NEXT_TO_STORAGE;
      }

      const dropoff = primaryRoom.getReserveStructureWithRoomForResource(resource.resourceType);

      const haulersWithTask = haulers.filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
        return task === TASKS.TASK_HAUL && pickup === resource.id;
      });

      const haulerCapacity = haulersWithTask.reduce((total, hauler) => {
        return total += hauler.store.getFreeCapacity();
      }, 0);

      const untaskedUsedCapacity = resource.amount - haulerCapacity;
      const loadsToHaul = Math.floor(untaskedUsedCapacity / avgHaulerCapacity);

      trace.log('loads', {avgHaulerCapacity, haulerCapacity, untaskedUsedCapacity, loadsToHaul});

      for (let i = 0; i < loadsToHaul; i++) {
        // Reduce priority for each load after first
        const loadPriority = priority - PRIORITIES.LOAD_FACTOR * i;

        const details = {
          [MEMORY.TASK_ID]: `pickup-${this.roomName}-${Game.time}`,
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
          [MEMORY.MEMORY_HAUL_PICKUP]: resource.id,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff?.id || undefined,
          [MEMORY.MEMORY_HAUL_RESOURCE]: resource.resourceType,
          [MEMORY.MEMORY_HAUL_AMOUNT]: resource.amount,
        };

        trace.log('haul dropped', {room: primaryRoom.id, topic, i, loadPriority, details});

        kingdom.sendRequest(topic, loadPriority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
      }
    });
  }

  requestHaulTombstones(trace: Tracer, kingdom: Kingdom, base: BaseConfig, orgRoom: OrgRoom, room: Room) {
    if (this.alertLevel !== AlertLevel.GREEN) {
      trace.warn('not requesting haul tombstones, not green');
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
          [MEMORY.TASK_ID]: `pickup-${this.roomName}-${Game.time}`,
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
          [MEMORY.MEMORY_HAUL_PICKUP]: tombstone.id,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: resourceType,
          [MEMORY.MEMORY_HAUL_AMOUNT]: tombstone.store[resourceType],
        };

        let topic = getBaseHaulerTopic(base.id);
        let priority = PRIORITIES.HAUL_DROPPED;

        trace.log('haul tombstone', {topic, priority, details});
        kingdom.sendRequest(topic, priority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
      });
    });
  }

  produceStatus(trace: Tracer, orgRoom: OrgRoom) {
    const resources = orgRoom.getReserveResources();

    const status = {
      [MEMORY.ROOM_STATUS_NAME]: orgRoom.id,
      [MEMORY.ROOM_STATUS_LEVEL]: orgRoom.getRoomLevel(),
      [MEMORY.ROOM_STATUS_LEVEL_COMPLETED]: orgRoom.getRoomLevelCompleted(),
      [MEMORY.ROOM_STATUS_TERMINAL]: orgRoom.hasTerminal(),
      [MEMORY.ROOM_STATUS_ENERGY]: resources[RESOURCE_ENERGY] || 0,
      [MEMORY.ROOM_STATUS_ALERT_LEVEL]: this.alertLevel,
    };

    trace.log('producing room status', {status});

    orgRoom.getKingdom().sendRequest(TOPICS.ROOM_STATUES, 1, status, PRODUCE_STATUS_TTL);

    const line: HudLine = {
      key: `room_${orgRoom.id}`,
      room: orgRoom.id,
      order: 1,
      text: `Room: ${orgRoom.id} - status: ${this.alertLevel}, level: ${orgRoom.getRoomLevel()}`,
      time: Game.time,
    };
    const event = new Event(orgRoom.id, Game.time, HudEventSet, line);
    orgRoom.getKingdom().getBroker().getStream(getLinesStream()).publish(event);
  }

  produceDefenseStatus(trace: Tracer, kingdom: Kingdom, base: BaseConfig, room: Room) {
    const hostiles = room.find(FIND_HOSTILE_CREEPS).filter((creep) => {
      return kingdom.isFriendly(creep.owner.username);
    });

    const invaderCores = room.find(FIND_STRUCTURES).filter((structure) => {
      return structure.structureType === STRUCTURE_INVADER_CORE;
    });

    const invaders = hostiles.filter((creep) => {
      return creep.owner.username = 'Invader';
    });

    const defenders = room.find(FIND_HOSTILE_CREEPS).filter((creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER;
    });

    if (hostiles.length > 0 || invaders.length > 0 || invaderCores.length > 0) {
      this.alertLevel = AlertLevel.YELLOW;
    }

    if (hostiles.length > 3) {
      this.alertLevel = AlertLevel.RED;
    }

    // TODO score the different groups

    const status: RoomDefenseStatus = {
      time: Game.time,
      alertLevel: this.alertLevel,
      invaderCore: invaderCores.length > 0,
      invaderScore: {
        creeps: invaders.length,
      } as CreepScore,
      hostileScore: {
        creeps: hostiles.length,
      } as CreepScore,
      myScore: {
        creeps: defenders.length,
      } as CreepScore,
    };

    const event = new Event(this.roomName, Game.time, BaseDefenseStatusSet, status);
    kingdom.getBroker().getStream(getBaseRoomStatusStream(base.id)).publish(event);
  }
}
