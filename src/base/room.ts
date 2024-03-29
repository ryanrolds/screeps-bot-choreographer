import * as CREEPS from '../constants/creeps';
import * as MEMORY from '../constants/memory';
import * as PRIORITIES from '../constants/priorities';
import {creepIsFresh} from '../creeps/behavior/commute';
import {Tracer} from '../lib/tracing';
import {AlertLevel, Base, baseEnergyStorageCapacity, threadBase} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {Process, Runnable, RunnableResult, sleeping, terminate} from '../os/process';
import {Priorities, Scheduler} from '../os/scheduler';
import {BaseRoomThreadFunc, threadBaseRoom} from '../os/threads/base_room';
import MineralRunnable from './mineral';
import SourceRunnable from './source';
import {createSpawnRequest, getBaseSpawnTopic, getShardSpawnTopic} from './spawning';

const MIN_RESERVATION_TICKS = 4000;
const NO_VISION_TTL = 20;
const MIN_TTL = 10;
const REQUEST_RESERVER_TTL = 25;
const UPDATE_PROCESSES_TTL = 50;

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
    this.threadRequestReserver = threadBase('request_reserver_thread', REQUEST_RESERVER_TTL)(this.requestReserver.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');

    trace.info('room run', {
      id: this.id,
    });

    const base = kernel.getPlanner().getBaseByRoom(this.id);
    if (!base) {
      trace.error('no base config, terminating', {id: this.id});
      trace.end();
      return terminate();
    }

    // Request reservers if needed
    if (this.id != base.primary) {
      this.threadRequestReserver(trace, kernel, base, this.id);
    }

    const room = Game.rooms[this.id];
    if (!room) {
      trace.notice('cannot find room in game', {id: this.id});
      return sleeping(NO_VISION_TTL);
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
          trace.info('found source without process, starting', {sourceId: source.id, room: this.id});
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

  requestReserver(trace: Tracer, kernel: Kernel, base: Base, roomName: string) {
    const reserver = _.find(Game.creeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_RESERVER) &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === roomName && creepIsFresh(creep);
    });

    if (reserver) {
      return;
    }

    // If base is under threat, don't worry about remotes
    if (base.alertLevel !== AlertLevel.GREEN) {
      trace.notice('not requesting reserver, base alert level is not green', {
        roomName: roomName,
        baseId: base.id,
        alertLevel: base.alertLevel,
      });

      return;
    }

    const roomEntry = kernel.getScribe().getRoomById(roomName);
    if (!roomEntry) {
      trace.error('cannot find room entry', {roomName: roomName});
      return;
    }

    // If owned by me we don't need reserver
    if (roomEntry.controller?.owner === kernel.getPlanner().getUsername()) {
      if (roomEntry.controller?.level > 0) {
        trace.notice('not requesting reserver, room is owned by me', {
          roomName: roomName,
          baseId: base.id,
        });

        return;
      }

      // Reservation, check min reservation ticks
      if (roomEntry.controller?.downgrade > MIN_RESERVATION_TICKS) {
        trace.notice('not requesting reserver, room is owned by me and reservation is long enough', {
          roomName: roomName,
          baseId: base.id,
        });

        return;
      }
    }

    trace.notice('sending reserve request to base', {room: roomName, base: base.id});

    const priority = PRIORITIES.PRIORITY_RESERVER;
    const ttl = REQUEST_RESERVER_TTL + Game.time;
    const role = CREEPS.WORKER_RESERVER;
    const memory = {
      [MEMORY.MEMORY_ASSIGN_ROOM]: this.id,
      [MEMORY.MEMORY_BASE]: base.id,
    };

    let topic = getShardSpawnTopic();
    if (baseEnergyStorageCapacity(base) >= 650) {
      topic = getBaseSpawnTopic(base.id);
    }

    const request = createSpawnRequest(priority, ttl, role, memory, null, 0);
    kernel.getTopics().addRequestV2(topic, request);
  }
}
