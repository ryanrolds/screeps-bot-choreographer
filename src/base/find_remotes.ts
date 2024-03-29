/**
 * Logic for determining base remotes
 *
 * The goal is to create a dynamic list of rooms near the base that can be safely mined.
 *
 * Over a few passes, rooms adjacent to the base and rooms checked in previous passes are
 * added to a list if they are safe to mine. It's possible for a room to not be safe to mine,
 * but be passable.
 *
 * TODO: Move to remotes.ts
 */
import {newMultipliers} from '../creeps/builders/attacker';
import {buildDefender} from '../creeps/builders/defender';
import {Tracer} from '../lib/tracing';
import {Base, getBasePrimaryRoom} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';

const PASSES = 3;

export const findRemotes = (kernel: Kernel, base: Base, trace: Tracer): [string[], Map<string, string>] => {
  trace.info('checking remote mining', {baseId: base.id});

  const scribe = kernel.getScribe();
  const candidates: Set<string> = new Set();
  const dismissed: Map<string, string> = new Map();
  const seen: Set<string> = new Set();

  // Add the primary room to the list of seen rooms
  seen.add(base.primary);

  const startRoomStatus = Game.map.getRoomStatus(base.primary).status;
  let nextPass = [base.primary];

  trace.info('starting remote selection pass', {nextPass, maxPasses: PASSES, startRoomStatus});

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
        const [passable, dismiss] = checkCandidate(kernel, base, adjacentRoom,
          startRoomStatus, trace);

        trace.info('checked candidate room', {
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

        trace.info('adding room to candidates', {adjacentRoom});
        candidates.add(adjacentRoom);
      });
    });

    nextPass = found;
  }

  if (candidates.size === 0) {
    trace.info('no candidates rooms found', {candidates: Array.from(candidates.keys()), base});
    return [[], dismissed];
  }

  trace.info('candidates rooms found', {
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

  trace.info('next remote mining rooms', {sortedCandidates});
  //return [sortedCandidates, debug];
  return [sortedCandidates, dismissed];
};

export function checkCandidate(kernel: Kernel, base: Base, room: string,
  baseRoomStatus: string, trace: Tracer): [boolean, string] {
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

  // filter out rooms that do not have a source
  if (roomEntry.numSources === 0) {
    return [true, 'no sources'];
  }

  // Filter our rooms without a controller
  if (!roomEntry.controller?.pos) {
    return [true, 'no controller'];
  }

  // Filter out rooms that are claimed by players
  if (roomEntry.controller?.owner &&
    roomEntry.controller?.owner !== kernel.getPlanner().getUsername() &&
    roomEntry.controller.owner !== 'Invader') {
    return [false, 'is owned'];
  }

  // If enemies present that we cannot beat, do not consider this room
  const damage = _.max([roomEntry.hostilesDmg, roomEntry.keepersDmg]);
  if (damage > 0) {
    const basePrimary = getBasePrimaryRoom(base);
    if (!basePrimary) {
      return [false, 'no primary room'];
    }

    const multipliers = newMultipliers();
    const [_parts, ok] = buildDefender(damage, basePrimary.energyCapacityAvailable,
      multipliers, trace);
    if (!ok) {
      trace.warn('defender build failed, we cannot take the room', {
        roomEntry, basePrimary, damage,
        energyCapacityAvailable: basePrimary.energyCapacityAvailable
      });
      return [false, 'hostiles too strong'];
    }

    trace.warn('defender build succeeded, we can take the room', {
      roomEntry, basePrimary, damage,
      energyCapacityAvailable: basePrimary.energyCapacityAvailable
    });

    // TODO: When defense of remotes is sorted out, remove this
    return [false, 'hostiles present'];
  }


  return [true, '']
}

// Calculate the max number of remotes based on level and number of spawns
// TODO collect spawner saturation metrics and use that to calculate max remotes
export function desiredRemotes(base: Base, level: number, spawnUtilization: number, trace: Tracer): number {
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

    trace.info(`${base.id} should drop a room`);
  } else if (spawnUtilization < 0.5) {
    trace.info(`${base.id} should add a room`);
  } else {
    trace.info(`${base.id} should keep the same number of rooms`);
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
      desiredRemotes = 3;
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
