import {ColonyConfig} from "./config";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {RoomEntry} from "./org.scribe";

type ColonyPolicy = {
  start: string;
  maxLinearDistance: number;
  minRoomLevel: number;
  hasSpawn: boolean;
}

type RoomPolicy = {
  avoidHostileRooms: boolean;
  avoidFriendlyRooms: boolean;
  avoidRoomsWithKeepers: boolean;
  avoidUnloggedRooms: boolean;
  // some rooms can be newbie, respawn, and other status, which can be blocked
  sameRoomStatus: boolean; // TODO
  avoidRoomsWithTowers: boolean;
  costMatrixType: AllowedCostMatrixTypes;
}

type DestinationPolicy = {
  range: number;
}

type PathPolicy = {
  allowIncomplete: boolean;
  maxSearchRooms: number;
  maxPathRooms: number;
  ignoreCreeps: boolean;
  maxOps: number;
  plainCost?: number;
  swampCost?: number;
}

export type FindColonyPathPolicy = {
  colony: ColonyPolicy;
  room: RoomPolicy;
  destination: DestinationPolicy;
  path: PathPolicy;
};

export type FindPathPolicy = {
  room: RoomPolicy;
  destination: DestinationPolicy;
  path: PathPolicy;
};

export type PathSearchDetails = {
  tries: number;
  passes: number;
  searchedRooms: Record<string, boolean>;
  blockedRooms: Record<string, boolean>;
  incompletePaths: PathFinderPath[];
};

interface RouteCallback {
  (roomName: string, fromRoomName: string): any;
}

interface RoomCallbackFunc {
  (roomName: string): (boolean | CostMatrix);
}

export const getPath = (kingdom: Kingdom, origin: RoomPosition, destination: RoomPosition,
  policy: FindPathPolicy, trace: Tracer): [PathFinderPath, PathSearchDetails] => {
  trace.log('get path', {
    origin,
    destination,
    policy,
  });

  const pathDetails: PathSearchDetails = {
    tries: 3,
    passes: 0,
    searchedRooms: {},
    blockedRooms: {},
    incompletePaths: [],
  }

  for (; pathDetails.passes < pathDetails.tries; pathDetails.passes++) {
    // Get list of rooms on the way to destination
    const roomRoute = Game.map.findRoute(origin.roomName, destination.roomName, {
      routeCallback: getRoomRouteCallback(kingdom, destination.roomName, policy.room,
        pathDetails, trace),
    });

    // If we have no route, return null
    if (roomRoute === ERR_NO_PATH) {
      trace.log('not route through rooms', {origin, destination});
      return [null, pathDetails];
    }

    trace.log('found path through rooms', {route: roomRoute.map((room) => room.room)});

    // Map findRoute results to map of names for fast lookup
    const allowedRooms: Record<string, boolean> = _.reduce(roomRoute, (acc, room) => {
      acc[room.room] = true;
      return acc;
    }, {});

    // Add origin room to list of allowed room
    allowedRooms[origin.roomName] = true;

    const result = PathFinder.search(origin, {
      pos: destination,
      range: policy.destination.range
    }, {
      maxRooms: policy.path.maxSearchRooms,
      roomCallback: getRoomCallback(kingdom, destination.roomName, policy.room, allowedRooms, trace),
      maxOps: policy.path.maxOps,
      plainCost: policy.path.plainCost || 2,
      swampCost: policy.path.swampCost || 5,
    });

    trace.log('path result', {result})

    // If route is complete or we don't care, go with it
    if (result.incomplete === false || policy.path.allowIncomplete) {
      trace.log('success', {incomplete: result.incomplete, allowIncomplete: policy.path.allowIncomplete});
      return [result, pathDetails];
    }

    // If route has no where to go, fail
    if (result.path.length <= 1) {
      trace.log('path length <= 1', {result});
      return [null, pathDetails];
    }

    // Add last room to blocked and try again if allowed
    const lastRoom = result.path[result.path.length - 1].roomName;
    trace.log('blocking last room', {
      lastRoom,
      attempt: pathDetails.passes,
      tries: pathDetails.tries
    });
    pathDetails.blockedRooms[lastRoom] = true;
    pathDetails.incompletePaths.push(result);
  }

  return [null, pathDetails];
}

export const getClosestColonyByPath = (kingdom: Kingdom, destination: RoomPosition,
  policy: FindColonyPathPolicy, trace: Tracer): ColonyConfig => {
  const roomEntry = kingdom.getScribe().getRoomById(destination.roomName);

  let selectedColony: ColonyConfig = null;
  let selectedPathLength = 99999;

  // Get colonies and filter by the policy
  let colonyConfigs = kingdom.getPlanner().getColonyConfigs();
  colonyConfigs = applyAllowedColonyPolicy(colonyConfigs, roomEntry, policy.colony, trace);
  // Iterate colonies and find the closest one within the policies
  colonyConfigs.forEach((config) => {
    // Get the origin position from the colony by apply the colony policy
    const originPosition = getOriginPosition(kingdom, config, policy.colony, trace);
    if (!originPosition) {
      trace.log("no origin position", {colony: config.id});
      return;
    }

    trace.log('checking colony', {
      colony: config.id,
      origin: originPosition,
      dest: destination,
      policy: policy.colony,
      roomEntry: roomEntry,
    });

    // Find the path from the origin to the destination
    const [result, debug] = getPath(kingdom, originPosition, destination, policy, trace);
    if (!result) {
      trace.log("null result", {originPosition, destination, policy, trace});
      return;
    }

    // If the path is longer then the current selection, skip
    if (result.path.length > selectedPathLength) {
      trace.log('path is too long', {
        length: result.path.length,
        roomId: roomEntry.id,
        colonyId: config.id,
      });
      return;
    }

    // If path has more rooms then allowed, skip
    const roomsInPath = _.uniq(result.path.map((pos) => pos.roomName));
    if (roomsInPath.length > policy.path.maxPathRooms) {
      trace.log('too many rooms in path', {roomsInPath});
      return;
    }

    trace.log('setting path', {
      length: result.path.length,
      roomId: roomEntry.id,
      colonyId: config.id,
    })

    // Update the selected colony and path
    selectedColony = config;
    selectedPathLength = result.path.length;
  });

  return selectedColony;
}

const applyAllowedColonyPolicy = (colonyConfigs: ColonyConfig[], destRoomEntry: RoomEntry,
  policy: ColonyPolicy, trace: Tracer): ColonyConfig[] => {

  // Do not search colonies below the minimum level
  if (policy.minRoomLevel) {
    trace.log('applying min room level', {minRoomLevel: policy.minRoomLevel});

    colonyConfigs = colonyConfigs.filter((config) => {
      const room = Game.rooms[config.primary];
      if (!room) {
        trace.log('room not found', {room: config.primary});
        return false;
      }

      return _.get(config, 'controller.level', 0) >= policy.minRoomLevel;
    });
  }

  // Do not search colonies further than the max linear distance
  if (policy.maxLinearDistance) {
    trace.log('applying linear distance filter', {maxLinearDistance: policy.maxLinearDistance});

    colonyConfigs = colonyConfigs.filter((config) => {
      return Game.map.getRoomLinearDistance(destRoomEntry.id, config.primary) <= policy.maxLinearDistance;
    });
  }

  trace.log('filtered colonies', {colonies: colonyConfigs.map((colony) => colony.id)});

  return colonyConfigs
}

const getOriginPosition = (kingdom: Kingdom, colonyConfig: ColonyConfig, policy: ColonyPolicy,
  trace: Tracer): RoomPosition => {

  if (policy.start === "spawn") {
    return colonyConfig.origin;
  }

  return null;
}

const getRoomRouteCallback = (kingdom: Kingdom, destRoom: string, policy: RoomPolicy,
  searchDetails: PathSearchDetails, trace: Tracer): RouteCallback => {
  return (toRoom: string, fromRoom: string): number => {
    searchDetails.searchedRooms[toRoom] = true;

    // Always allow entry to destination room
    if (destRoom === toRoom) {
      return 1;
    }

    if (searchDetails.blockedRooms[toRoom]) {
      trace.log('room is blocked', {toRoom});
      return Infinity;
    }

    const roomEntry = kingdom.getScribe().getRoomById(toRoom);
    trace.log('room route entry', {fromRoom, toRoom, roomEntry});

    // If we have not scanned the room, dont enter it
    if (!roomEntry && policy.avoidUnloggedRooms) {
      trace.log('room not logged', {toRoom});
      return Infinity;
    }

    if (roomEntry) {
      const allow = applyRoomCallbackPolicy(kingdom, roomEntry, policy, trace);
      if (!allow) {
        trace.log('room not allowed', {toRoom});
        return Infinity;
      }
    }

    return 1;
  }
}

const getRoomCallback = (kingdom: Kingdom, destRoom: string, policy: RoomPolicy,
  allowedRooms: Record<string, boolean>, trace: Tracer): RoomCallbackFunc => {
  return (roomName: string): (boolean | CostMatrix) => {
    if (destRoom !== roomName) {
      if (!allowedRooms[roomName]) {
        trace.log('room not allowed', {roomName});
        return false;
      }

      const roomEntry = kingdom.getScribe().getRoomById(roomName);
      trace.log('room route entry', {roomName, roomEntry});

      // If we have not scanned the room, dont enter it
      if (!roomEntry && policy.avoidUnloggedRooms) {
        trace.log('room not logged', {roomName});
        return false;
      }

      if (roomEntry) {
        const allow = applyRoomCallbackPolicy(kingdom, roomEntry, policy, trace);
        if (!allow) {
          trace.log('room not allowed by policy', {roomName});
          return false;
        }
      }
    }

    const costMatrix = kingdom.getCostMatrixCache().getCostMatrix(kingdom, roomName, policy.costMatrixType, trace)
    if (typeof (costMatrix) !== 'boolean') {
      trace.log("cost matrix", {roomName, matrix: costMatrix.serialize()});
    }

    return costMatrix;
  }
}

const applyRoomCallbackPolicy = (kingdom: Kingdom, roomEntry: RoomEntry,
  policy: RoomPolicy, trace: Tracer): boolean => {
  const owner = roomEntry.controller?.owner;
  const ownerIsNotMe = owner !== 'ENETDOWN';
  const isFriendly = kingdom.config.friends.includes(owner)

  trace.log('room owner', {roomId: roomEntry.id, owner, ownerIsNotMe, isFriendly});

  if (owner && ownerIsNotMe && policy.avoidFriendlyRooms && isFriendly) {
    trace.log('room is friendly, avoid', {roomName: roomEntry.id, owner});
    return false;
  }

  if (owner && ownerIsNotMe && policy.avoidHostileRooms && !isFriendly) {
    trace.log('room is hostile, avoid', {roomName: roomEntry.id, owner});
    return false;
  }

  if (policy.avoidRoomsWithKeepers && roomEntry.hasKeepers) {
    trace.log('room has keepers, avoid', {roomName: roomEntry.id});
    return false;
  }

  if (policy.avoidRoomsWithTowers && roomEntry.numTowers) {
    trace.log('room has towers, avoid', {roomName: roomEntry.id});
    return false;
  }

  if (policy.sameRoomStatus) {
    // TODO
    /*
    const roomStatus = Game.map.getRoomStatus(room.id);
    if (originStatus.status != roomStatus.status) {
      trace.log('intermediate room is different statues', {originStatus, roomStatus});
      return false;
    }
    */
  }

  trace.log('room allowed', {roomName: roomEntry.id});

  return true;
}
