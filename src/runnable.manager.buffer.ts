import * as _ from 'lodash';
import {AttackRequest, AttackStatus, ATTACK_ROOM_TTL} from './constants.attack';
import * as TOPICS from './constants.topics';
import {Kernel} from './kernel';
import {AllowedCostMatrixTypes} from './lib.costmatrix_cache';
import {FindBasePathPolicy, getClosestBaseByPath} from './lib.pathing';
import {Tracer} from './lib.tracing';
import {sleeping} from './os.process';
import {RunnableResult} from './os.runnable';
import {TargetRoom} from './runnable.scribe';

export const BufferPathPolicy: FindBasePathPolicy = {
  base: {
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
    range: 2,
  },
  path: {
    allowIncomplete: false,
    maxSearchRooms: 16,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
  },
};

const RUN_TTL = 10;

export default class BufferManager {
  id: string;

  constructor(id: string, trace: Tracer) {
    this.id = id;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('buffer_manager_run');

    const hostileRoomsByBase = getHostileRoomsByBase(kernel, trace);
    hostileRoomsByBase.forEach((rooms, baseId) => {
      if (rooms.length < 1) {
        trace.info('no hostiles rooms', {baseId, rooms});
        return;
      }

      const base = kernel.getPlanner().getBaseById(baseId);
      if (!base) {
        trace.info('no base', {baseId});
        return;
      }

      const room = _.sortByAll(rooms, ['level', 'id']).shift();
      if (!room) {
        return;
      }

      trace.notice('attack hostile room', {baseId, room});

      const attackRequest: AttackRequest = {
        status: AttackStatus.REQUESTED,
        roomId: room.id,
      };

      kernel.getTopics().addRequest(TOPICS.ATTACK_ROOM, 1, attackRequest, ATTACK_ROOM_TTL);
    });

    // TODO add HUD line and attack lines on map

    trace.end();

    return sleeping(RUN_TTL);
  }
}

type HostileRoomsByBase = Map<string, TargetRoom[]>;

function getHostileRoomsByBase(kernel: Kernel, trace: Tracer): HostileRoomsByBase {
  const hostileRooms = kernel.getScribe().getHostileRooms(kernel);
  trace.info('hostile rooms', {hostileRooms});

  const config = kernel.getConfig();
  const dontAttack = config.friends.concat(config.neutral);
  const candidateRooms = hostileRooms.filter((room) => {
    return dontAttack.indexOf(room.owner) === -1 && room.level <= 7;
  });
  trace.info('candidate rooms', {config, dontAttack, candidateRooms});

  const hostileRoomsByBase: Map<string, TargetRoom[]> = new Map();

  // TODO fix this
  BufferPathPolicy.base.maxLinearDistance = config.buffer;

  candidateRooms.forEach((room) => {
    const base = getClosestBaseByPath(kernel, room.controllerPos, BufferPathPolicy, trace);
    if (!base) {
      trace.info('no base', {room});
      return;
    }

    if (!hostileRoomsByBase.has(base.id)) {
      hostileRoomsByBase.set(base.id, []);
    }

    trace.info('attack room from', {base, room});
    hostileRoomsByBase.set(base.id, hostileRoomsByBase.get(base.id).concat(room));
  });

  trace.info('hostile rooms by base', {hostileRoomsByBase: hostileRoomsByBase});

  return hostileRoomsByBase;
}
