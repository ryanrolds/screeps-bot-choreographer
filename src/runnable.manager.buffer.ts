import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import TOPICS from './constants.topics';
import CREEPS from './constants.creeps';
import * as PRIORITIES from './constants.priorities';
import MEMORY from './constants.memory';
import Colony from './org.colony';
import {thread} from './os.thread';
import {TargetRoom} from './org.scribe'

const PATROL_TTL = 50;
const MAX_PATROLS = 1;

export default class BufferManager {
  id: string;
  scheduler: Scheduler;
  threadEnforceBuffer: any;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;

    this.threadEnforceBuffer = thread(PATROL_TTL, null, null)(enforceBuffer)
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    this.threadEnforceBuffer(kingdom, trace);

    return running();
  }
}

function enforceBuffer(kingdom: Kingdom, trace: Tracer) {
  const patrolsByColony = getPatrolsByColony(kingdom, trace);
  const hostileRoomsByColony = getHostileRoomsByColony(kingdom, trace);
  trace.log('hostile rooms by colony', {patrolsByColony, hostileRoomsByColony});

  _.forEach(hostileRoomsByColony, (rooms, colonyId) => {
    if (rooms.length < 1) {
      trace.log("no hostile rooms", {colonyId})
      return;
    }

    const colony = kingdom.getColonyById(colonyId);
    if (!colony) {
      trace.log('expect to find colony, but did not', {colonyId});
      return;
    }

    const room = _.sortByAll(rooms, ['level', 'id']).shift();
    if (!room) {
      trace.log("should have room", {rooms, colonyId});
      return;
    }

    const patrols = patrolsByColony[colonyId] || [];
    const roomPos = new RoomPosition(25, 25, room.id);

    trace.notice('attack hostile room', {colonyId, numDefenders: patrols.length, roomPos});

    //requestExistingBufferPatrol(patrol, roomPos);
    if (patrols.length < MAX_PATROLS) {
      //requestAdditionalBufferPatrol(colony, trace);
    }
  });
}

type Patrol = {
  id: string;
  creeps: Creep[];
  targetRoom: Id<Room>;
}
type PatrolsByColony = Record<string, Patrol[]>;

function getPatrolsByColony(kingdom: Kingdom, trace: Tracer): PatrolsByColony {
  const patrolsByColony = {};

  // TODO

  return patrolsByColony;
}

type HostileRoomsByColony = Record<string, TargetRoom[]>;

function getHostileRoomsByColony(kingdom: Kingdom, trace: Tracer): HostileRoomsByColony {
  const config = kingdom.config;
  const dontAttack = config.friends.concat(config.neutral);
  const weakRooms = kingdom.getScribe().getWeakRooms().filter((room) => {
    return dontAttack.indexOf(room.owner) === -1;
  });

  trace.log("hostile rooms", {
    dontAttack,
    numWeakRooms: weakRooms.length,
    numRooms: kingdom.getScribe().getRoomsUpdatedRecently().length,
  });

  const hostileRoomsByColony = {};

  const colonies = kingdom.getColonies().filter(colony => colony.primaryRoom.controller.level >= 6)
  colonies.forEach((colony) => {
    const nearByWeakRooms = weakRooms.filter((room) => {
      const distance = Game.map.getRoomLinearDistance(colony.primaryRoomId, room.id);
      return distance <= kingdom.config.buffer;
    });

    hostileRoomsByColony[colony.id] = nearByWeakRooms;
  });

  return hostileRoomsByColony;
}

function requestExistingBufferPatrol(defenders: Creep[], position: RoomPosition) {
  const positionStr = [position.x, position.y, position.roomName].join(',');

  // Order existing defenders to the room and last known location
  defenders.forEach((defender) => {
    defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = position.roomName;
    defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = positionStr;
  });
}

function requestAdditionalBufferPatrol(colony: Colony, needed: number, trace: Tracer) {
  for (let i = 0; i < needed; i++) {
    trace.log('requesting defender', {colonyId: (colony as any).id});

    colony.sendRequest(TOPICS.TOPIC_DEFENDERS, PRIORITIES.PRIORITY_BUFFER_PATROL, {
      role: CREEPS.WORKER_DEFENDER,
      spawn: true,
      memory: {}
    }, PATROL_TTL);
  }
}
