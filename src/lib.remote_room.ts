import {ColonyConfig} from "./config";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";




export const findNextRemoteRoom = (kingdom: Kingdom, colonyConfig: ColonyConfig, trace: Tracer): string => {
  trace.log('checking remote mining', {colonyConfig});

  if (!colonyConfig.automated) {
    trace.log('not automated', {colonyConfig});
    return null;
  }

  const room = Game.rooms[colonyConfig.primary];
  if (!room) {
    trace.log('no room found', {colonyConfig});
    return;
  }

  const level = room?.controller?.level || 0;
  let numDesired = desiredRemotes(level);
  const numCurrent = colonyConfig.rooms.length - 1;
  if (numDesired <= numCurrent) {
    colonyConfig.rooms = colonyConfig.rooms.slice(0, numDesired + 1);

    trace.log('remote mining not needed', {numDesired, numCurrent});
    return;
  }

  let exits = colonyConfig.rooms.reduce((acc, roomName) => {
    const exits = Game.map.describeExits(roomName);
    return acc.concat(Object.values(exits));
  }, [] as string[]);

  let adjacentRooms: string[] = _.uniq(exits);
  adjacentRooms = _.difference(adjacentRooms, colonyConfig.rooms);

  trace.log('adjacent rooms', {adjacentRooms});

  const scribe = kingdom.getScribe();
  adjacentRooms = _.filter(adjacentRooms, (roomName) => {
    // filter rooms already belonging to a colony
    const colonyConfig = kingdom.getPlanner().getColonyConfigByRoom(roomName);
    if (colonyConfig) {
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

    return true;
  });

  if (adjacentRooms.length === 0) {
    trace.log('no adjacent rooms found', {adjacentRooms, exits, colonyConfig});
    return;
  }

  adjacentRooms = _.sortBy(adjacentRooms, (roomName) => {
    const route = Game.map.findRoute(colonyConfig.primary, roomName) || [];
    if (route === ERR_NO_PATH) {
      return 9999;
    }

    return route.length;
  });

  if (adjacentRooms.length !== 0) {
    const nextRoom = adjacentRooms[0];
    trace.log('next room', {nextRoom});
    return nextRoom;
  }

  trace.log('no adjacent rooms found', {adjacentRooms, exits, colonyConfig});

  return null;
}


function desiredRemotes(level: number): number {
  let desiredRemotes = 0;
  switch (level) {
    case 0:
    case 1:
      break; // 0
    case 2:
    case 3:
    case 4:
      desiredRemotes = 2;
      break;
    case 5:
    case 6:
      // Increased size of haulers causes spawning bottleneck
      // ignoring for now
      desiredRemotes = 2;
      break;
    case 7:
      desiredRemotes = 4;
    case 8:
      desiredRemotes = 6;
      break;
    default:
      throw new Error('unexpected controller level');
  }

  return desiredRemotes;
}
