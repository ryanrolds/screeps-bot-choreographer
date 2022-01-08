import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import * as TOPICS from './constants.topics';
import {thread, ThreadFunc} from './os.thread';
import {TargetRoom} from './org.scribe';
import {ATTACK_ROOM_TTL, AttackRequest, AttackStatus} from './constants.attack';
import {FindColonyPathPolicy, getClosestColonyByPath} from './lib.pathing';
import {AllowedCostMatrixTypes} from './lib.costmatrix_cache';

const policy: FindColonyPathPolicy = {
  colony: {
    start: 'spawn',
    maxLinearDistance: 5,
    minRoomLevel: 0,
    hasSpawn: true,
  },
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: true,
    avoidRoomsWithKeepers: false,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.PARTY,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: false,
    maxSearchRooms: 16,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
  },
};

export default class BufferManager {
  id: string;
  scheduler: Scheduler;
  threadEnforceBuffer: ThreadFunc;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;

    this.threadEnforceBuffer = thread('enforce_buffer_thread', ATTACK_ROOM_TTL)(enforceBuffer);
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('buffer_manager_run');

    this.threadEnforceBuffer(trace, kingdom);

    trace.end();

    return running();
  }
}

function enforceBuffer(trace: Tracer, kingdom: Kingdom) {
  const hostileRoomsByColony = getHostileRoomsByColony(kingdom, trace);

  _.forEach(hostileRoomsByColony, (rooms, colonyId) => {
    if (rooms.length < 1) {
      return;
    }

    const colony = kingdom.getColonyById(colonyId);
    if (!colony) {
      return;
    }

    const room = _.sortByAll(rooms, ['level', 'id']).shift();
    if (!room) {
      return;
    }

    trace.notice('attack hostile room', {colonyId, room});

    const attackRequest: AttackRequest = {
      status: AttackStatus.REQUESTED,
      colonyId,
      roomId: room.id,
    };

    kingdom.sendRequest(TOPICS.ATTACK_ROOM, 1, attackRequest, ATTACK_ROOM_TTL);
  });
}

type HostileRoomsByColony = Record<string, TargetRoom[]>;

function getHostileRoomsByColony(kingdom: Kingdom, trace: Tracer): HostileRoomsByColony {
  const config = kingdom.config;
  const dontAttack = config.friends.concat(config.neutral);
  const weakRooms = kingdom.getScribe().getWeakRooms().filter((room) => {
    return dontAttack.indexOf(room.owner) === -1;
  });

  const hostileRoomsByColony: Record<string, TargetRoom[]> = {};

  // TODO fix this
  policy.colony.maxLinearDistance = kingdom.config.buffer;

  weakRooms.forEach((room) => {
    const colony = getClosestColonyByPath(kingdom, room.controllerPos, policy, trace)
    if (!colony) {
      return;
    }

    if (!hostileRoomsByColony[colony.id]) {
      hostileRoomsByColony[colony.id] = [];
    }

    hostileRoomsByColony[colony.id].push(room);
  });

  return hostileRoomsByColony;
}
