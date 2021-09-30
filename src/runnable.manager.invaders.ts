import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {Scheduler} from "./os.scheduler";
import {RoomEntry} from "./org.scribe";
import {FindColonyPathPolicy, getClosestColonyByPath} from "./lib.pathing";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";

const RUN_TTL = 50;
const MAX_BASE_LEVEL = 1;

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
    trace = trace.asId(this.id).begin('invader_manager_run');

    const rooms = getRoomEntriesWithInvaderBases(kingdom, trace);

    trace.notice('found defeatable invader bases', {
      rooms: rooms.map((roomEntry) => roomEntry.id)
    });

    rooms.forEach((roomEntry) => {
      const destination = roomEntry.invaderCorePos;
      const colony = getClosestColonyByPath(kingdom, destination, colonyPathingPolicy, trace);
      if (colony) {
        trace.log("attack invader base", {room: roomEntry.id, colony: colony.id});
      } else {
        trace.log("no colony to attack invader base", {room: roomEntry.id});
      }
    });

    trace.end();

    return sleeping(RUN_TTL);
  }
}

const getRoomEntriesWithInvaderBases = (kingdom: Kingdom, trace: Tracer): RoomEntry[] => {
  return kingdom.getScribe().getRooms().filter((roomEntry) => {
    if (!roomEntry.invaderCoreLevel) {
      return false;
    }

    if (roomEntry.invaderCoreLevel <= 0) {
      return false;
    }

    if (roomEntry.invaderCoreLevel > MAX_BASE_LEVEL) {
      trace.notice('invader base too strong', {id: roomEntry.id, level: roomEntry.invaderCoreLevel});
      return false;
    }

    // TODO remove when we dont have any room entries without the pos
    if (!roomEntry.invaderCorePos) {
      trace.notice('no position for invader base', {id: roomEntry.id})
      return false;
    }

    return true;
  });
}
