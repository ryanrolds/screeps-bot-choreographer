import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import * as TOPICS from './constants.topics';
import {thread} from './os.thread';
import {TargetRoom} from './org.scribe'

const ATTACK_ROOM_TTL = 100;

export default class BufferManager {
  id: string;
  scheduler: Scheduler;
  threadEnforceBuffer: any;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;

    this.threadEnforceBuffer = thread(ATTACK_ROOM_TTL, null, null)(enforceBuffer)
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    this.threadEnforceBuffer(kingdom, trace);

    return running();
  }
}

function enforceBuffer(kingdom: Kingdom, trace: Tracer) {
  const hostileRoomsByColony = getHostileRoomsByColony(kingdom, trace);
  trace.log('hostile rooms by colony', {hostileRoomsByColony});

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

      // Find the route and avoid rooms owned by other people
      const route = Game.map.findRoute(room.id, colony.primaryRoomId, {
        routeCallback: (toRoom, fromRoom) => {
          const roomDetails = kingdom.getScribe().getRoomById(toRoom);

          // If we have not scanned the room, dont enter it
          if (!roomDetails) {
            // trace.log('room not logged', {toRoom, fromRoom});
            return Infinity;
          }

          // If owned by someone else and its not the target room, dont enter it
          if (roomDetails.controller?.owner && toRoom !== room.id) {
            // trace.log('room owned by someone', {toRoom, fromRoom, owner: roomDetails.controller.owner});
            return Infinity;
          }

          return 1;
        },
      });

      if (route === ERR_NO_PATH) {
        // trace.log('no path', {
        //   roomId: room.id,
        //   distance: linearDistance,
        //   colonyId: colony.id,
        // });
        return false;
      }

      if (route.length > kingdom.config.buffer) {
        // trace.log('room near by path too long', {routeLength: route.length, roomId: room.id, colonyId: colony.id});
        return false;
      }

      return true;
    });

    hostileRoomsByColony[colony.id] = nearByWeakRooms;
  });

  return hostileRoomsByColony;
}
