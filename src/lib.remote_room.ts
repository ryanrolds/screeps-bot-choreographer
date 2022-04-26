import {BaseConfig} from "./config";
import {Tracer} from "./lib.tracing";
import {Colony} from "./org.colony";
import {Kingdom} from "./org.kingdom";


type RoomDetails = {
  distance?: number;
  rejected?: string;
  sources?: number;
}

type DebugDetails = {
  adjacentRooms: string[];
  details: Record<string, RoomDetails>;
};

export const findNextRemoteRoom = (
  kingdom: Kingdom,
  baseConfig: BaseConfig,
  trace: Tracer,
): [string, DebugDetails] => {
  trace.notice('checking remote mining', {baseConfig});

  let debug: DebugDetails = {
    adjacentRooms: [],
    details: {},
  };

  let exits = baseConfig.rooms.reduce((acc, roomName) => {
    const exits = Game.map.describeExits(roomName);
    return acc.concat(Object.values(exits));
  }, [] as string[]);

  let adjacentRooms: string[] = _.uniq(exits);
  adjacentRooms = _.difference(adjacentRooms, baseConfig.rooms);

  debug.adjacentRooms = adjacentRooms;

  const scribe = kingdom.getScribe();
  adjacentRooms = _.filter(adjacentRooms, (roomName) => {
    debug.details[roomName] = {};

    // filter rooms already belonging to a colony
    const roomBaseConfig = kingdom.getPlanner().getBaseConfigByRoom(roomName);
    if (roomBaseConfig && baseConfig.id !== roomBaseConfig.id) {
      debug.details[roomName].rejected = 'already assigned';
      trace.info('room already assigned to colony', {roomName});
      return false;
    }

    const roomEntry = scribe.getRoomById(roomName);

    // filter out rooms we have not seen
    if (!roomEntry) {
      debug.details[roomName].rejected = 'not seen';
      trace.info('no room entry found', {roomName});
      return false
    }

    // filter out rooms that do not have a source
    if (roomEntry.numSources === 0) {
      debug.details[roomName].rejected = 'no source';
      trace.info('room has no sources', {roomName});
      return false;
    }

    if (!roomEntry.controller?.pos) {
      debug.details[roomName].rejected = 'no controller';
      trace.info('has no controller pos', {roomName});
      return false;
    }

    if (roomEntry.controller.owner) {
      debug.details[roomName].rejected = 'has owner';
      trace.info('has controller owner', {roomName});
      return false;
    }

    return true;
  });

  if (adjacentRooms.length === 0) {
    trace.info('no adjacent rooms found', {adjacentRooms, exits, baseConfig});
    return [null, debug];
  }

  adjacentRooms = _.sortByOrder(adjacentRooms,
    [
      (roomName) => { // Sort by number of sources
        const roomEntry = scribe.getRoomById(roomName);

        debug.details[roomName].sources = roomEntry.numSources;
        return roomEntry.numSources;
      },
      (roomName) => { // Sort by distance from primary room
        const route = Game.map.findRoute(baseConfig.primary, roomName);
        if (route === ERR_NO_PATH) {
          debug.details[roomName].distance = 9999;
          return 9999;
        }

        debug.details[roomName].distance = route.length;
        return route.length;
      }
    ],
    ['desc', 'asc'],
  );

  trace.info('next remote mining rooms', {adjacentRooms});

  if (adjacentRooms.length === 0) {
    trace.info('no adjacent rooms found', {adjacentRooms, exits, baseConfig});
    return [null, debug];
  }

  const nextRoom = adjacentRooms[0];
  trace.info('next remote mining room', {nextRoom, debug});
  return [nextRoom, debug];
}

// Calculate the max number of remotes based on level and number of spawns
// TODO collect spawner saturation metrics and use that to calculate max remotes
export function desiredRemotes(colony: Colony, level: number): number {
  const room = colony.primaryRoom;
  const spawns = room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN && s.isActive()
  });

  // No spawns, no remotes
  if (!spawns.length) {
    return 0;
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
