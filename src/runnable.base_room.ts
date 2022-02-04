import {creepIsFresh} from './behavior.commute';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import {Event} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
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

const MIN_RESERVATION_TICKS = 4000;
const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const REQUEST_RESERVER_TTL = 25;
const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 30;
const UPDATE_PROCESSES_TTL = 50;
const PRODUCE_STATUS_TTL = 25;

export default class RoomRunnable {
  id: string;
  scheduler: Scheduler;

  threadUpdateProcessSpawning: ThreadFunc;
  threadRequestReserver: ThreadFunc;
  threadRequestHaulDroppedResources: ThreadFunc;
  threadRequestHaulTombstones: ThreadFunc;
  threadProduceStatus: ThreadFunc;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;

    // Threads
    this.threadUpdateProcessSpawning = thread('spawn_room_processes_thread', UPDATE_PROCESSES_TTL)(this.handleProcessSpawning.bind(this));
    this.threadRequestReserver = thread('request_reserver_thread', REQUEST_RESERVER_TTL)(this.requestReserver.bind(this));
    this.threadRequestHaulDroppedResources = thread('request_haul_dropped_thread', REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulDroppedResources.bind(this));
    this.threadRequestHaulTombstones = thread('request_haul_tombstone_thread', REQUEST_HAUL_DROPPED_RESOURCES_TTL)(this.requestHaulTombstones.bind(this));
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

    // TODO try to remove dependency on OrgRoom
    const orgRoom = kingdom.getRoomByName(this.id);
    if (!orgRoom) {
      trace.error("no org room, terminating", {id: this.id})
      trace.end();
      return terminate();
    }

    const room = Game.rooms[this.id];
    if (!room) {
      trace.notice('cannot find room in game', {id: this.id});
      return sleeping(NO_VISION_TTL);
    }

    if (!orgRoom.isPrimary) {
      this.threadRequestReserver(trace, kingdom, baseConfig, orgRoom, room);
    }

    this.threadUpdateProcessSpawning(trace, orgRoom, room);
    this.threadRequestHaulDroppedResources(trace, kingdom, baseConfig, orgRoom, room);
    this.threadRequestHaulTombstones(trace, kingdom, baseConfig, orgRoom, room);
    this.threadProduceStatus(trace, orgRoom);

    trace.end();
    return sleeping(MIN_TTL);
  }

  handleProcessSpawning(trace: Tracer, orgRoom: OrgRoom, room: Room) {
    if (room.controller?.my || !room.controller?.owner?.username) {
      // Sources
      room.find(FIND_SOURCES).forEach((source) => {
        const sourceId = `${source.id}`
        if (!this.scheduler.hasProcess(sourceId)) {
          trace.log("found source without process, starting", {sourceId: source.id, room: this.id});
          this.scheduler.registerProcess(new Process(sourceId, 'sources', Priorities.RESOURCES,
            new SourceRunnable(orgRoom, source)));
        }
      });

      if (orgRoom.isPrimary && orgRoom.getRoomLevel() >= 6) {
        // Mineral
        room.find(FIND_MINERALS).forEach((mineral) => {
          const mineralId = `${mineral.id}`
          if (!this.scheduler.hasProcess(mineralId)) {
            this.scheduler.registerProcess(new Process(mineralId, 'mineral', Priorities.RESOURCES,
              new MineralRunnable(orgRoom, mineral)));
          }
        });
      }
    }
  }

  requestReserver(trace: Tracer, kingdom: Kingdom, base: BaseConfig, orgRoom: OrgRoom, room: Room) {
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
          [MEMORY.MEMORY_BASE]: (orgRoom as any).getColony().id,
        },
      }

      let topic = getKingdomSpawnTopic()
      if (orgRoom.getColony().primaryRoom.energyCapacityAvailable > 800) {
        topic = getBaseSpawnTopic(base.id);
      }

      kingdom.sendRequest(topic, PRIORITIES.PRIORITY_RESERVER, details, REQUEST_RESERVER_TTL);
    }
  }

  requestHaulDroppedResources(trace: Tracer, kingdom: Kingdom, base: BaseConfig,
    orgRoom: OrgRoom, room: Room) {
    if (orgRoom.numHostiles) {
      return;
    }

    // Get resources to haul
    let droppedResourcesToHaul = room.find(FIND_DROPPED_RESOURCES);

    // No resources to haul, we are done
    if (!droppedResourcesToHaul.length) {
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
          [MEMORY.TASK_ID]: `pickup-${this.id}-${Game.time}`,
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
          [MEMORY.MEMORY_HAUL_PICKUP]: resource.id,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff?.id || undefined,
          [MEMORY.MEMORY_HAUL_RESOURCE]: resource.resourceType,
          [MEMORY.MEMORY_HAUL_AMOUNT]: resource.amount,
        };

        trace.log('haul dropped', {room: primaryRoom.id, topic, i, loadPriority, details});

        orgRoom.sendRequest(topic, loadPriority, details, REQUEST_HAUL_DROPPED_RESOURCES_TTL);
      }
    });
  }

  requestHaulTombstones(trace: Tracer, kingdom: Kingdom, base: BaseConfig, orgRoom: OrgRoom, room: Room) {
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
      [MEMORY.ROOM_STATUS_ALERT_LEVEL]: orgRoom.getAlertLevel(),
    };

    trace.log('producing room status', {status});

    orgRoom.getKingdom().sendRequest(TOPICS.ROOM_STATUES, 1, status, PRODUCE_STATUS_TTL);

    const line: HudLine = {
      key: `room_${orgRoom.id}`,
      room: orgRoom.id,
      order: 1,
      text: `Room: ${orgRoom.id} - status: ${orgRoom.getAlertLevel()}, level: ${orgRoom.getRoomLevel()}`,
      time: Game.time,
    };
    const event = new Event(orgRoom.id, Game.time, HudEventSet, line);
    orgRoom.getKingdom().getBroker().getStream(getLinesStream()).publish(event);
  }
}
