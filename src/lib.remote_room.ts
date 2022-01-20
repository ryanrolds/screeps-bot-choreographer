import {trace} from "console";
import {BaseConfig} from "./config";
import {Tracer} from "./lib.tracing";
import {Colony} from "./org.colony";
import {Kingdom} from "./org.kingdom";

export const findNextRemoteRoom = (kingdom: Kingdom, baseConfig: BaseConfig, room: Room, trace: Tracer): string => {
  trace.log('checking remote mining', {baseConfig});

  let exits = baseConfig.rooms.reduce((acc, roomName) => {
    const exits = Game.map.describeExits(roomName);
    return acc.concat(Object.values(exits));
  }, [] as string[]);

  let adjacentRooms: string[] = _.uniq(exits);
  adjacentRooms = _.difference(adjacentRooms, baseConfig.rooms);

  trace.log('adjacent rooms', {adjacentRooms});

  const scribe = kingdom.getScribe();
  adjacentRooms = _.filter(adjacentRooms, (roomName) => {
    // filter rooms already belonging to a colony
    const roomBaseConfig = kingdom.getPlanner().getBaseConfigByRoom(roomName);
    if (roomBaseConfig && baseConfig.id !== roomBaseConfig.id) {
      trace.log('room already assigned to colony', {roomName});
      return false;
    }

    const roomEntry = scribe.getRoomById(roomName);

    // filter out rooms we have not seen
    if (!roomEntry) {
      trace.log('no room entry found', {roomName});
      return false
    }

    // filter out rooms that do not have a source
    if (roomEntry.numSources === 0) {
      trace.log('room has no sources', {roomName});
      return false;
    }

    if (!roomEntry.controller?.pos) {
      trace.log('has no controller pos', {roomName});
      return false;
    }

    if (roomEntry.controller.owner) {
      trace.log('has controller owner', {roomName});
      return false;
    }

    return true;
  });

  if (adjacentRooms.length === 0) {
    trace.log('no adjacent rooms found', {adjacentRooms, exits, baseConfig});
    return;
  }

  adjacentRooms = _.sortByOrder(adjacentRooms,
    [
      (roomName) => { // Sort by distance from primary room
        const route = Game.map.findRoute(baseConfig.primary, roomName) || [];
        if (route === ERR_NO_PATH) {
          return 9999;
        }

        return route.length;
      },
      (roomName) => { // Sort by number of sources
        const roomEntry = scribe.getRoomById(roomName);
        return roomEntry.numSources;
      }
    ],
    ['asc', 'desc'],
  );

  trace.notice('next remote mining rooms', {adjacentRooms});

  if (adjacentRooms.length !== 0) {
    const nextRoom = adjacentRooms[0];
    trace.log('next remote mining room', {nextRoom});
    return nextRoom;
  }

  trace.log('no adjacent rooms found', {adjacentRooms, exits, baseConfig});
  return null;
}

export function desiredRemotes(colony: Colony, level: number): number {
  const room = colony.primaryRoom;
  const spawns = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN && s.isActive()
  });

  let desiredRemotes = 0;
  switch (level) {
    case 0:
    case 1:
    case 2:
    case 3:
      desiredRemotes = 5;
      break;
    case 4:
      desiredRemotes = 4;
      break;
    case 5:
      // Tried 4 & 3 and at level 5 it was choking - Jan 2022
      desiredRemotes = 2;
      break;
    case 6:
      // Tried 2 and 3, it was choking - Jan 2022
      desiredRemotes = 1;
      break;
    case 7:
    case 8:
      if (spawns.length < 2) {
        desiredRemotes = 1;
      } else if (spawns.length < 3) {
        desiredRemotes = 3;
      } else {
        desiredRemotes = 6;
      }
      break;
    default:
      throw new Error('unexpected controller level');
  }

  // Disabled for now - Jan 2022
  // if (!room.storage) {
  return desiredRemotes;
  // }

  // const energyReserve = colony.getReserveResources()[RESOURCE_ENERGY] || 0;
  // const energyRoomLimit = Math.floor(energyReserve / 50000);
  // return _.min([desiredRemotes, energyRoomLimit]);
}
