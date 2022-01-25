import {BaseConfig} from "./config";
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

  const pathDetails: PathSearchDetails = {
    tries: 1,
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
      return [null, pathDetails];
    }

    // Map findRoute results to map of names for fast lookup
    const allowedRooms: Record<string, boolean> = _.reduce(roomRoute, (acc, room) => {
      acc[room.room] = true;
      return acc;
    }, {});

    // Add origin room to list of allowed room
    allowedRooms[origin.roomName] = true;

    const goal = {
      pos: destination,
      range: policy.destination.range
    };

    const opts: PathFinderOpts = {
      maxRooms: policy.path.maxSearchRooms,
      roomCallback: getRoomCallback(kingdom, destination.roomName, policy.path, policy.room, allowedRooms, trace),
      maxOps: policy.path.maxOps,
      plainCost: policy.path.plainCost || 2,
      swampCost: policy.path.swampCost || 5,
    };

    trace.log('findPath', {origin, goal, opts});

    const result = PathFinder.search(origin, goal, opts);

    // If route is complete or we don't care, go with it
    if (result.incomplete === false || policy.path.allowIncomplete) {
      return [result, pathDetails];
    }

    // If route has no where to go, fail
    if (result.path.length <= 1) {
      return [null, pathDetails];
    }

    // Add last room to blocked and try again if allowed
    const lastRoom = result.path[result.path.length - 1].roomName;
    if (lastRoom === destination.roomName) {
      return [null, pathDetails];
    }

    if (lastRoom != destination.roomName) {
      pathDetails.blockedRooms[lastRoom] = true;
      pathDetails.incompletePaths.push(result);
    }
  }

  return [null, pathDetails];
}

export const getClosestColonyByPath = (kingdom: Kingdom, destination: RoomPosition,
  policy: FindColonyPathPolicy, trace: Tracer): BaseConfig => {
  const roomEntry = kingdom.getScribe().getRoomById(destination.roomName);

  let selectedColony: BaseConfig = null;
  let selectedPathLength = 99999;

  // Get colonies and filter by the policy
  let baseConfigs = kingdom.getPlanner().getBaseConfigs();
  baseConfigs = applyAllowedColonyPolicy(baseConfigs, roomEntry, policy.colony, trace);
  // Iterate colonies and find the closest one within the policies
  baseConfigs.forEach((config) => {
    // Get the origin position from the colony by apply the colony policy
    const originPosition = getOriginPosition(kingdom, config, policy.colony, trace);
    if (!originPosition) {
      return;
    }

    // Find the path from the origin to the destination
    const [result, debug] = getPath(kingdom, originPosition, destination, policy, trace);
    if (!result) {
      return;
    }

    // If the path is longer then the current selection, skip
    if (result.path.length > selectedPathLength) {
      return;
    }

    // If path has more rooms then allowed, skip
    const roomsInPath = _.uniq(result.path.map((pos) => pos.roomName));
    if (roomsInPath.length > policy.path.maxPathRooms) {
      return false;
    }

    // Update the selected colony and path
    selectedColony = config;
    selectedPathLength = result.path.length;
  });

  return selectedColony;
}

const applyAllowedColonyPolicy = (baseConfigs: BaseConfig[], destRoomEntry: RoomEntry,
  policy: ColonyPolicy, trace: Tracer): BaseConfig[] => {

  // Do not search colonies below the minimum level
  if (policy.minRoomLevel) {
    baseConfigs = baseConfigs.filter((config) => {
      const room = Game.rooms[config.primary];
      if (!room) {
        trace.warn('room not found', {room: config.primary});
        return false;
      }

      return _.get(config, 'controller.level', 0) >= policy.minRoomLevel;
    });
  }

  // Do not search colonies further than the max linear distance
  if (policy.maxLinearDistance) {
    baseConfigs = baseConfigs.filter((config) => {
      return Game.map.getRoomLinearDistance(destRoomEntry.id, config.primary) <= policy.maxLinearDistance;
    });
  }

  trace.log('filtered colonies', {colonies: baseConfigs.map((colony) => colony.id)});

  return baseConfigs
}

const getOriginPosition = (kingdom: Kingdom, baseConfig: BaseConfig, policy: ColonyPolicy,
  trace: Tracer): RoomPosition => {

  if (policy.start === "spawn") {
    return baseConfig.origin;
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
      return Infinity;
    }

    const roomEntry = kingdom.getScribe().getRoomById(toRoom);

    // If we have not scanned the room, dont enter it
    if (!roomEntry && policy.avoidUnloggedRooms) {
      return Infinity;
    }

    if (roomEntry) {
      const allow = applyRoomCallbackPolicy(kingdom, roomEntry, policy, trace);
      if (!allow) {
        return Infinity;
      }
    }

    return 1;
  }
}

const getRoomCallback = (kingdom: Kingdom, destRoom: string, pathPolicy: PathPolicy,
  roomPolicy: RoomPolicy, allowedRooms: Record<string, boolean>, trace: Tracer): RoomCallbackFunc => {
  return (roomName: string): (boolean | CostMatrix) => {
    if (destRoom !== roomName) {
      if (!allowedRooms[roomName]) {
        return false;
      }

      const roomEntry = kingdom.getScribe().getRoomById(roomName);

      // If we have not scanned the room, dont enter it
      if (!roomEntry && roomPolicy.avoidUnloggedRooms) {
        return false;
      }

      if (roomEntry) {
        const allow = applyRoomCallbackPolicy(kingdom, roomEntry, roomPolicy, trace);
        if (!allow) {
          return false;
        }
      }
    }

    let costMatrix = kingdom.getCostMatrixCache().getCostMatrix(kingdom, roomName,
      roomPolicy.costMatrixType, trace);

    const room = Game.rooms[roomName];
    if (room && !pathPolicy.ignoreCreeps) {
      costMatrix = costMatrix.clone();

      room.find(FIND_CREEPS).forEach((creep) => {
        costMatrix.set(creep.pos.x, creep.pos.y, 255);
      });
    }

    return costMatrix;
  }
}

const applyRoomCallbackPolicy = (kingdom: Kingdom, roomEntry: RoomEntry,
  policy: RoomPolicy, trace: Tracer): boolean => {
  const owner = roomEntry.controller?.owner;
  const ownerIsNotMe = owner !== 'ENETDOWN';
  const isFriendly = kingdom.config.friends.includes(owner)

  if (owner && ownerIsNotMe && policy.avoidFriendlyRooms && isFriendly) {
    return false;
  }

  if (owner && ownerIsNotMe && policy.avoidHostileRooms && !isFriendly) {
    return false;
  }

  if (policy.avoidRoomsWithKeepers && roomEntry.hasKeepers) {
    return false;
  }

  if (policy.avoidRoomsWithTowers && roomEntry.numTowers) {
    return false;
  }

  if (policy.sameRoomStatus) {
    // TODO
    /*
    const roomStatus = Game.map.getRoomStatus(room.id);
    if (originStatus.status != roomStatus.status) {
      return false;
    }
    */
  }

  trace.log('room allowed', {roomName: roomEntry.id});

  return true;
}


export const visualizePath = (path: RoomPosition[], trace: Tracer) => {
  const pathByRooms = path.reduce((acc, pos) => {
    if (!acc[pos.roomName]) {
      acc[pos.roomName] = [];
    }

    acc[pos.roomName].push(pos);

    return acc;
  }, {} as Record<string, RoomPosition[]>);

  // Display in the rooms
  Object.entries(pathByRooms).forEach(([key, value]) => {
    new RoomVisual(key).poly(value);
  });
}
