import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import * as TOPICS from './constants.topics';
import {thread, ThreadFunc} from './os.thread';
import {TargetRoom} from './org.scribe'

const ATTACK_ROOM_TTL = 20;

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
    trace = trace.asId(this.id).begin('buffer_manager_run');

    this.threadEnforceBuffer(trace, kingdom);

    trace.end();

    return running();
  }
}

function enforceBuffer(trace: Tracer, kingdom: Kingdom) {
  const hostileRoomsByColony = getHostileRoomsByColony(kingdom, trace);
  trace.notice('hostile rooms by colony', {hostileRoomsByColony});

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

    trace.notice('attack hostile room', {colonyId, room});

    kingdom.sendRequest(TOPICS.ATTACK_ROOM, 1, {
      colony: colonyId,
      roomId: room.id,
    }, ATTACK_ROOM_TTL);
  });
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
      trace.log('checking if room should be attacked', {colonyId: colony.id, weakRoom: room.id});

      // First narrow to linear distance to reduce the number of rooms to findRoute on
      const linearDistance = Game.map.getRoomLinearDistance(room.id, colony.primaryRoomId);
      if (linearDistance > kingdom.config.buffer) {
        // trace.log('weak room not near colony', {
        //   roomId: room.id,
        //   distance: linearDistance,
        //   colonyId: colony.id,
        // });
        return false;
      }

      const originStatus = Game.map.getRoomStatus(colony.primaryRoomId);
      const destinationStatus = Game.map.getRoomStatus(room.id);
      if (originStatus.status != destinationStatus.status) {
        trace.log('rooms are different statues', {originStatus, destinationStatus});
        return false;
      }

      const originSpawn = colony.primaryOrgRoom.getSpawns()[0];
      if (!originSpawn) {
        trace.log('no origin spawn', {colonyId: colony.id});
        return false;
      }

      const destinationController = room.controllerPos;

      const result = PathFinder.search(originSpawn.pos, {pos: destinationController, range: 5}, {
        maxRooms: 8,
        roomCallback: (roomName): (CostMatrix | false) => {
          const roomDetails = kingdom.getScribe().getRoomById(roomName);
          // If we have not scanned the room, dont enter it
          if (!roomDetails) {
            trace.log('room not logged', {roomName});
            return false;
          }

          // If owned by someone else and its not the target room, dont enter it
          trace.log('check if room owned and not destination', {
            roomName,
            roomId: room.id,
            isDestination: roomName === room.id,
            owner: roomDetails.controller?.owner,
          });

          const roomStatus = Game.map.getRoomStatus(room.id);
          if (originStatus.status != roomStatus.status) {
            trace.log('intermediate room is different statues', {originStatus, roomStatus});
            return false;
          }

          const owner = roomDetails.controller?.owner;
          const ownerIsNotMe = owner !== 'ENETDOWN';
          if (owner && ownerIsNotMe && roomName !== room.id) {
            trace.log('room owned by someone', {roomName, owner});
            return false;
          }

          return new PathFinder.CostMatrix();
        },
      });

      if (result.incomplete) {
        trace.log('path incomplete', {result});
        return false;
      }

      const roomsInPath = _.uniq(result.path.map((pos) => pos.roomName));
      if (roomsInPath.length > kingdom.config.buffer + 1) {
        trace.log('too many rooms in path', {roomsInPath});
        return false;
      }

      return true;
    });

    hostileRoomsByColony[colony.id] = nearByWeakRooms;
  });

  return hostileRoomsByColony;
}