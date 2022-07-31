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
      const adjacentRooms = Object.values(Game.map.describeExits(currentRoom));
      adjacentRooms.forEach((adjacentRoom) => {
        if (!seen.has(adjacentRoom)) {
          found.push(adjacentRoom);
        }

        seen.add(adjacentRoom);

        if (dismissed.has(adjacentRoom)) {
          return;
        }

        // filter rooms already belonging to a colony
        const roomBase = kernel.getPlanner().getBaseByRoom(adjacentRoom);
        if (roomBase && base.id !== roomBase.id) {
          dismissed.set(adjacentRoom, 'already assigned to a base');
          return;
        }

        const roomEntry = scribe.getRoomById(adjacentRoom);
        // filter out rooms we have not seen
        if (!roomEntry) {
          dismissed.set(adjacentRoom, 'no entry in scribe');
          return;
        }

        // If enemies present do not claim
        // TODO make this vary based on the size of defender we can build
        if (roomEntry.hostilesDmg > 25) {
          dismissed.set(adjacentRoom, 'hostile present');
          return;
        }

        // filter out rooms that do not have a source
        if (roomEntry.numSources === 0) {
          dismissed.set(adjacentRoom, 'no sources');
          return;
        }

        // Filter our rooms without a controller
        if (!roomEntry.controller?.pos) {
          dismissed.set(adjacentRoom, 'no controller');
          return;
        }

        // Filter out rooms that are claimed
        if (roomEntry.controller?.owner && roomEntry.controller?.level > 0) {
          dismissed.set(adjacentRoom, 'is owned');
          return;
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

// Check existing rooms if we should drop them due to change in circumstances
// tl;dr if the room is occupied or taken then we should stop mining it
export function checkRoom(kernel: Kernel, base: Base, roomName: string, trace: Tracer): boolean {
  trace.info('checking remote room', {roomName});

  const roomEntry = kernel.getScribe().getRoomById(roomName);
  if (!roomEntry) {
    trace.warn('room not found', {roomName: roomName});
    return true;
  }

  // If room is controlled by someone else, don't claim it
  if (roomEntry?.controller?.owner !== kernel.getPlanner().getUsername() &&
    roomEntry?.controller?.level > 0) {
    trace.warn('room owned, removing remove', {roomName: roomName});
    return false;
  }

  // if room is occupied by a overwhelming force else, don't claim it
  if (roomEntry.hostilesDmg > 25) {
    trace.warn('room occupied, removing remove', {roomName: roomName, hostileDmg: roomEntry.hostilesDmg});
    return false;
  }

  trace.notice("room checked", {
    roomName: roomName, hostileDmg: roomEntry.hostilesDmg,
    age: Game.time - roomEntry.lastUpdated
  });

  return true;
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
