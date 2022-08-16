import {AttackRequest, AttackStatus, ATTACK_ROOM_TTL} from '../constants/attack';
import {ATTACK_ROOM} from '../constants/topics';
import {Tracer} from '../lib/tracing';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, sleeping} from '../os/process';
import {Scheduler} from '../os/scheduler';
import {RoomEntry} from './scribe';

const RUN_TTL = 50;
const MAX_BASE_LEVEL = 2;

export default class InvaderManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('invader_manager_run');

    const rooms = getRoomEntriesWithInvaderBases(kernel, trace);
    trace.notice('found defeatable invader bases', {
      rooms: rooms.map((roomEntry) => {
        return {id: roomEntry.id, pos: roomEntry.invaderCorePos};
      }),
    });

    rooms.forEach((roomEntry) => {
      trace.info('requesting attack', {roomId: roomEntry.id});

      const attackRequest: AttackRequest = {
        status: AttackStatus.REQUESTED,
        roomId: roomEntry.id,
      };

      kernel.getTopics().addRequest(ATTACK_ROOM, 1, attackRequest, ATTACK_ROOM_TTL);
    });

    trace.end();

    return sleeping(RUN_TTL);
  }
}

const getRoomEntriesWithInvaderBases = (kernel: Kernel, trace: Tracer): RoomEntry[] => {
  const end = trace.startTimer('getRoomEntriesWithInvaderBases');

  const weakRooms = kernel.getScribe().getRooms().filter((roomEntry) => {
    if (!roomEntry.invaderCoreLevel) {
      return false;
    }

    if (roomEntry.invaderCoreLevel <= 0) {
      return false;
    }

    if (roomEntry.invaderCoreLevel > MAX_BASE_LEVEL) {
      trace.info('invader base too strong', {id: roomEntry.id, level: roomEntry.invaderCoreLevel});
      return false;
    }

    // TODO remove when we dont have any room entries without the pos
    if (!roomEntry.invaderCorePos) {
      trace.error('no position for invader base', {id: roomEntry.id});
      return false;
    }

    return true;
  });

  end();

  return weakRooms;
};
