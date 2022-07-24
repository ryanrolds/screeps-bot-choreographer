import {AlertLevel, Base, baseEnergyStorageCapacity} from './base';
import {BaseRoomThreadFunc, threadBaseRoom} from './base_room';
import {creepIsFresh} from './behavior.commute';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {Process, sleeping, terminate} from './os.process';
import {Runnable, RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from './os.scheduler';
import MineralRunnable from './runnable.base_room_mineral';
import SourceRunnable from './runnable.base_room_source';
import {createSpawnRequest, getBaseSpawnTopic, getShardSpawnTopic} from './runnable.base_spawning';

const MIN_RESERVATION_TICKS = 4000;
const NO_VISION_TTL = 20;
const MIN_TTL = 10;

const REQUEST_RESERVER_TTL = 25;
const UPDATE_PROCESSES_TTL = 50;
const PRODUCE_STATUS_TTL = 25;

export default class RoomRunnable implements Runnable {
  id: string;
  scheduler: Scheduler;

  threadUpdateProcessSpawning: BaseRoomThreadFunc;
  threadRequestReserver: BaseRoomThreadFunc;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;

    // Threads
    this.threadUpdateProcessSpawning = threadBaseRoom('spawn_room_processes_thread', UPDATE_PROCESSES_TTL)(this.handleProcessSpawning.bind(this));
    this.threadRequestReserver = threadBaseRoom('request_reserver_thread', REQUEST_RESERVER_TTL)(this.requestReserver.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');

    trace.log('room run', {
      id: this.id,
    });

    const base = kernel.getPlanner().getBaseByRoom(this.id);
    if (!base) {
      trace.error('no base config, terminating', {id: this.id});
      trace.end();
      return terminate();
    }

    const room = Game.rooms[this.id];
    if (!room) {
      trace.notice('cannot find room in game', {id: this.id});
      return sleeping(NO_VISION_TTL);
    }

    if (room.name != base.primary) {
      this.threadRequestReserver(trace, kernel, base, room);
    }

    this.threadUpdateProcessSpawning(trace, kernel, base, room);

    trace.end();
    return sleeping(MIN_TTL);
  }

  handleProcessSpawning(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    if (room.controller?.my || !room.controller?.owner?.username) {
      // Sources
      room.find(FIND_SOURCES).forEach((source) => {
        const sourceId = `${source.id}`;
        if (!this.scheduler.hasProcess(sourceId)) {
          trace.log('found source without process, starting', {sourceId: source.id, room: this.id});
          this.scheduler.registerProcess(new Process(sourceId, 'sources', Priorities.RESOURCES,
            new SourceRunnable(source)));
        }
      });

      if (base.primary === room.name && room.controller?.level >= 6) {
        // Mineral
        room.find(FIND_MINERALS).forEach((mineral) => {
          const mineralId = `${mineral.id}`;
          if (!this.scheduler.hasProcess(mineralId)) {
            this.scheduler.registerProcess(new Process(mineralId, 'mineral', Priorities.RESOURCES,
              new MineralRunnable(mineral)));
          }
        });
      }
    }
  }

  requestReserver(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const numReservers = _.filter(Game.creeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_RESERVER) &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === this.id && creepIsFresh(creep);
    }).length;

    if (numReservers) {
      return;
    }

    // If base is under threat, don't worry about remotes
    if (base.alertLevel !== AlertLevel.GREEN) {
      trace.info('not requesting reserver, base alert level is not green', {
        roomName: room.name,
        baseId: base.id,
        alertLevel: base.alertLevel,
      });

      return;
    }

    // If owned by me we don't need reserver
    if (room.controller?.owner?.username === kernel.getPlanner().getUsername()) {
      trace.info('not requesting reserver, room is owned by me', {
        roomName: room.name,
        baseId: base.id,
      });

      return;
    }

    if (room.controller?.reservation?.username === kernel.getPlanner().getUsername()) {
      let reservationTicks = 0;
      if (room?.controller?.reservation) {
        reservationTicks = room.controller.reservation.ticksToEnd;
      }

      // If reserved by me and reservation is not over soon, don't request reserver
      if (reservationTicks > MIN_RESERVATION_TICKS) {
        trace.info('not requesting reserver, room is owned by me', {
          roomName: room.name,
          baseId: base.id,
        });

        return;
      }
    }

    trace.log('sending reserve request to colony');

    const priority = PRIORITIES.PRIORITY_RESERVER;
    const ttl = REQUEST_RESERVER_TTL;
    const role = CREEPS.WORKER_RESERVER;
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      [MEMORY.MEMORY_BASE]: base.id,
    };

    let topic = getShardSpawnTopic();
    if (baseEnergyStorageCapacity(base) >= 800) {
      topic = getBaseSpawnTopic(base.id);
    }

    const request = createSpawnRequest(priority, ttl, role, memory, 0);
    kernel.getTopics().addRequestV2(topic, request);
  }
}
