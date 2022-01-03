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
import {getHudStream, HudLine, HudStreamEventSet} from './runnable.debug_hud';
import SourceRunnable from "./runnable.base_room_source";

const MIN_RESERVATION_TICKS = 4000;
const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const REQUEST_RESERVER_TTL = 25;
const REQUEST_HAUL_DROPPED_RESOURCES_TTL = 15;
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
      this.threadRequestReserver(trace, kingdom, orgRoom);
    }

    this.threadUpdateProcessSpawning(trace, orgRoom, room);
    this.threadRequestHaulDroppedResources(trace, orgRoom, room);
    this.threadRequestHaulTombstones(trace, orgRoom, room);
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
              new SourceRunnable(orgRoom, mineral)));
          }
        });
      }
    }
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
        orgRoom.requestSpawn(PRIORITIES.PRIORITY_RESERVER, details, REQUEST_RESERVER_TTL, trace);
      }
    }
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
    const event = new Event(orgRoom.id, Game.time, HudStreamEventSet, line);
    orgRoom.getKingdom().getBroker().getStream(getHudStream()).publish(event);
  }
}
