import {AttackRequest, AttackStatus, ATTACK_ROOM_TTL} from "./constants.attack";
import {ATTACK_ROOM} from "./constants.topics";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {FindColonyPathPolicy, getClosestColonyByPath} from "./lib.pathing";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {RoomEntry} from "./runnable.scribe";
import {sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Scheduler} from "./os.scheduler";

const RUN_TTL = 50;
const MAX_BASE_LEVEL = 2;

const colonyPathingPolicy: FindColonyPathPolicy = {
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
    maxPathRooms: 5,
    ignoreCreeps: true,
  },
};

export default class InvaderManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('invader_manager_run');

    const rooms = getRoomEntriesWithInvaderBases(kingdom, trace);
    trace.notice('found defeatable invader bases', {
      rooms: rooms.map((roomEntry) => {
        return {id: roomEntry.id, pos: roomEntry.invaderCorePos}
      }),
    });

    rooms.forEach((roomEntry) => {
      trace.log("requesting attack", {roomId: roomEntry.id})

      const attackRequest: AttackRequest = {
        status: AttackStatus.REQUESTED,
        roomId: roomEntry.id,
      };

      kingdom.sendRequest(ATTACK_ROOM, 1, attackRequest, ATTACK_ROOM_TTL);
    });

    trace.end();

    return sleeping(RUN_TTL);
  }
}

const getRoomEntriesWithInvaderBases = (kingdom: Kingdom, trace: Tracer): RoomEntry[] => {
  const end = trace.startTimer('getRoomEntriesWithInvaderBases');

  const weakRooms = kingdom.getScribe().getRooms().filter((roomEntry) => {
    if (!roomEntry.invaderCoreLevel) {
      return false;
    }

    if (roomEntry.invaderCoreLevel <= 0) {
      return false;
    }

    if (roomEntry.invaderCoreLevel > MAX_BASE_LEVEL) {
      trace.log('invader base too strong', {id: roomEntry.id, level: roomEntry.invaderCoreLevel});
      return false;
    }

    // TODO remove when we dont have any room entries without the pos
    if (!roomEntry.invaderCorePos) {
      trace.error('no position for invader base', {id: roomEntry.id})
      return false;
    }

    return true;
  });

  end();

  return weakRooms;
}
