import {Base, getBasePrimaryRoom} from './base';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';

const PASSES = 3;

type RoomDetails = {
  distance?: number;
  rejected?: string;
  sources?: number;
}

type DebugDetails = {
  start: string,
  adjacentRooms: string[][];
  details: Record<string, RoomDetails>;
};

export const findRemotes = (kernel: Kernel, base: Base, trace: Tracer): [string[], Map<string, string>] => {
  trace.notice('checking remote mining', {baseId: base.id});

  const scribe = kernel.getScribe();
  const candidates: Set<string> = new Set();
  const dismissed: Map<string, string> = new Map();
  const seen: Set<string> = new Set();

  const start = base.primary;
  const startRoomStatus = Game.map.getRoomStatus(base.primary).status;
  let nextPass = [start];

  trace.info('staring remote selection pass', {nextPass, maxPasses: PASSES, startRoomStatus});

  for (let i = 0; i <= PASSES; i++) {
    const found = [];

    nextPass.forEach((currentRoom) => {
      const exits = Game.map.describeExits(currentRoom);
      if (!exits) {
        trace.error('no exits found', {currentRoom});
        return;
      }

      const adjacentRooms = Object.values(exits);
      adjacentRooms.forEach((adjacentRoom) => {
        // Already dismissed this room, don't check it again
        if (dismissed.has(adjacentRoom)) {
          return;
        }

        // Already seen this room, don't check it again
        if (seen.has(adjacentRoom)) {
          return;
        }
        seen.add(adjacentRoom);

        // Check the room, determine if passable and if room is viable for mining
        const [passable, dismiss] = checkCandidateRoom(kernel, base, adjacentRoom, startRoomStatus);

        trace.notice('checked candidate room', {
          currentRoom,
          adjacentRoom,
          passable,
          dismiss,
        });

        // Room is passable, so add to list of rooms to check
        if (passable) {
          found.push(adjacentRoom);
        }

        // Room should not be considered as a candidate for mining
        if (dismiss) {
          dismissed.set(adjacentRoom, dismiss);
          return
        }

        trace.notice('adding room to candidates', {adjacentRoom});
        candidates.add(adjacentRoom);
      });
    });

    nextPass = found;
  }

  if (candidates.size === 0) {
    trace.info('no candidates rooms found', {candidates: Array.from(candidates.keys()), base});
    return [[], dismissed];
  }

  trace.notice('candidates rooms found', {
    candidates: Array.from(candidates.keys()),
    dismissed: Array.from(dismissed.entries()),
    base
  });

  const sortedCandidates: string[] = _.sortByOrder(Array.from(candidates.keys()), [
    (roomName) => { // Sort by distance from primary room
      const route = Game.map.findRoute(base.primary, roomName);
      if (route === ERR_NO_PATH) {
        return 9999;
      }

      return route.length;
    },
    (roomName) => { // Sort by number of sources
      const roomEntry = scribe.getRoomById(roomName);
      if (!roomEntry) {
        return 9999;
      }

      return roomEntry.numSources;
    }], ['asc', 'desc'],
  );

  trace.notice('next remote mining rooms', {sortedCandidates});
  //return [sortedCandidates, debug];
  return [sortedCandidates, dismissed];
};

export function checkCandidateRoom(kernel: Kernel, base: Base, room: string, baseRoomStatus: string): [boolean, string] {
  // room should be same status as base primary
  const roomStatus = Game.map.getRoomStatus(room).status;
  if (roomStatus !== baseRoomStatus) {
    return [false, 'status mismatch'];
  }

  // filter rooms already belonging to a base
  const roomBase = kernel.getPlanner().getBaseByRoom(room);
  if (roomBase && base.id !== roomBase.id) {
    return [true, 'already assigned to a base'];
  }

  const roomEntry = kernel.getScribe().getRoomById(room);
  // filter out rooms we have not seen
  if (!roomEntry) {
    return [false, 'no entry in scribe'];
  }

  // If enemies present do not claim
  // TODO make this vary based on the size of defender we can build
  if (roomEntry.hostilesDmg > 25) {
    return [false, 'hostile present'];
  }

  // filter out rooms that do not have a source
  if (roomEntry.numSources === 0) {
    return [true, 'no sources'];
  }

  // Filter our rooms without a controller
  if (!roomEntry.controller?.pos) {
    return [true, 'no controller'];
  }

  // Filter out rooms that are claimed
  if (roomEntry.controller?.owner && roomEntry.controller?.level > 0) {
    let passable = true;

    // If we own the room it's passable
    if (roomEntry.controller?.owner !== kernel.getPlanner().getUsername()) {
      passable = false;
    }

    return [passable, 'is owned'];
  }

  return [true, '']
}

// Calculate the max number of remotes based on level and number of spawns
// TODO collect spawner saturation metrics and use that to calculate max remotes
export function desiredRemotes(base: Base, level: number, spawnUtilization: number): number {
  const room = getBasePrimaryRoom(base);
  const spawns = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_SPAWN && s.isActive(),
  });

  // No spawns, no remotes
  if (!spawns.length) {
    return 0;
  }

  if (spawnUtilization > 0.9) {
    let numRooms = base.rooms.length - 2;
    if (numRooms < 0) {
      numRooms = 0;
    }

    console.log(`${base.id} should drop a room`);
  } else if (spawnUtilization < 0.5) {
    console.log(`${base.id} should add a room`);
  } else {
    console.log(`${base.id} should keep the same number of rooms`);
  }

  let desiredRemotes = 0;
  switch (level) {
    case 0:
    case 1:
    case 2:
    case 3:
      desiredRemotes = 3;
      break;
    case 4:
      desiredRemotes = 3;
      break;
    case 5:
      desiredRemotes = 2;
      break;
    case 6:
      desiredRemotes = 2;
      break;
    case 7:
    case 8:
      if (spawns.length < 2) {
        desiredRemotes = 1;
      } else if (spawns.length < 3) {
        desiredRemotes = 2;
      } else {
        desiredRemotes = 6;
      }
      break;
    default:
      throw new Error('unexpected controller level');
  }

  if (room.storage) {
    const reserveEnergy = room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
    if (reserveEnergy > 500000) {
      return _.min([desiredRemotes, 0]);
    } else if (reserveEnergy > 400000) {
      return _.min([desiredRemotes, 1]);
    }
  }

  return desiredRemotes;
}
