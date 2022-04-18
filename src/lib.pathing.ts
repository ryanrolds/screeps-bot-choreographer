import {BaseConfig} from "./config";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {getNearbyPositions} from "./lib.position";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {RoomEntry} from "./runnable.scribe";

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
  sourceKeeperBuffer?: number;
  controllerBuffer?: number;
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
  rejectedRooms: Record<string, string>;
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
    rejectedRooms: {},
    blockedRooms: {},
    incompletePaths: [],
  }

  for (; pathDetails.passes < pathDetails.tries; pathDetails.passes++) {
    // Get list of rooms on the way to destination
    const roomRoute = Game.map.findRoute(origin.roomName, destination.roomName, {
      routeCallback: getRoomRouteCallback(kingdom, origin.roomName, destination.roomName,
        policy.room, pathDetails, trace),
    });

    // If we have no route, return null
    if (roomRoute === ERR_NO_PATH) {
      trace.info('no room path', {origin: origin.roomName, destination: destination.roomName});
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
      roomCallback: getRoomCallback(kingdom, origin.roomName, destination.roomName,
        policy.path, policy.room, allowedRooms, pathDetails, trace),
      maxOps: policy.path.maxOps,
      plainCost: policy.path.plainCost || 2,
      swampCost: policy.path.swampCost || 5,
    };

    trace.info('findPath', {origin, goal, opts});

    const result = PathFinder.search(origin, goal, opts);

    // If route is complete or we don't care, go with it
    if (result.incomplete === false || policy.path.allowIncomplete) {
      trace.info('path found', {path: result.path});
      return [result, pathDetails];
    }

    // If route has no where to go, fail
    if (result.path.length <= 1) {
      trace.info('path length less than 1', {origin, goal, opts});
      return [null, pathDetails];
    }

    const lastRoom = result.path[result.path.length - 1].roomName;
    if (lastRoom === destination.roomName) {
      trace.info('last room is destination', {origin, goal, opts});
      return [null, pathDetails];
    }

    // Add last room to blocked and try again if allowed
    if (lastRoom != destination.roomName) {
      trace.info('last room not destination', {origin, goal, opts});
      pathDetails.blockedRooms[lastRoom] = true;
      pathDetails.incompletePaths.push(result);
    }
  }

  trace.info('passes exhausted', {origin});
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
      trace.error('no origin position', {config, policy});
      return;
    }

    // Find the path from the origin to the destination
    const [result, debug] = getPath(kingdom, originPosition, destination, policy, trace);
    if (!result) {
      trace.info('no path', {config, policy, debug});
      return;
    }

    // If the path is longer then the current selection, skip
    if (result.path.length > selectedPathLength) {
      trace.info('path too long', {config, policy, debug});
      return;
    }

    // If path has more rooms then allowed, skip
    const roomsInPath = _.uniq(result.path.map((pos) => pos.roomName));
    if (roomsInPath.length > policy.path.maxPathRooms) {
      trace.info('path has too many rooms long', {config, policy, debug});
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

const getRoomRouteCallback = (
  kingdom: Kingdom,
  originRoom: string,
  destRoom: string,
  policy: RoomPolicy,
  searchDetails: PathSearchDetails,
  trace: Tracer
): RouteCallback => {
  return (toRoom: string, fromRoom: string): number => {
    searchDetails.searchedRooms[toRoom] = true;

    // Always allow entry to destination room
    if (destRoom === toRoom) {
      return 1;
    }

    // Always allow movement in origin room
    if (originRoom === toRoom) {
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
      const [allow, reason] = applyRoomCallbackPolicy(kingdom, roomEntry, policy, trace);
      if (!allow) {
        searchDetails.rejectedRooms[toRoom] = reason;
        return Infinity;
      }
    }

    return 1;
  }
}

const getRoomCallback = (
  kingdom: Kingdom,
  originRoom: string,
  destRoom: string,
  pathPolicy: PathPolicy,
  roomPolicy: RoomPolicy,
  allowedRooms: Record<string, boolean>,
  pathDetails: PathSearchDetails,
  trace: Tracer
): RoomCallbackFunc => {
  return (roomName: string): (boolean | CostMatrix) => {
    // If this room is not destination, check if we should avoid it
    if (originRoom != roomName && destRoom !== roomName) {
      if (!allowedRooms[roomName]) {
        pathDetails.rejectedRooms[roomName] = 'not in allowed rooms';
        return false;
      }

      const roomEntry = kingdom.getScribe().getRoomById(roomName);

      // If we have not scanned the room, dont enter it
      if (!roomEntry && roomPolicy.avoidUnloggedRooms) {
        pathDetails.rejectedRooms[roomName] = 'unlogged';
        return false;
      }

      if (roomEntry) {
        const [allow, reason] = applyRoomCallbackPolicy(kingdom, roomEntry, roomPolicy, trace);
        if (!allow) {
          pathDetails.rejectedRooms[roomName] = reason;
          return false;
        }
      }
    }

    // Fetch cached cost matrix for the room
    let costMatrix = kingdom.getCostMatrixCache().getCostMatrix(kingdom, roomName,
      roomPolicy.costMatrixType, trace);

    const room = Game.rooms[roomName];

    // Mark creeps as not passible
    if (room && !pathPolicy.ignoreCreeps) {
      costMatrix = costMatrix.clone();

      room.find(FIND_CREEPS).forEach((creep) => {
        costMatrix.set(creep.pos.x, creep.pos.y, 255);
      });
    }

    // Add a buffer around source keepers
    if (room && pathPolicy.sourceKeeperBuffer > 0) {
      room.find(FIND_HOSTILE_CREEPS, {
        filter: (creep) => {
          return creep.owner.username === 'Source Keeper';
        }
      }).forEach((sourceKeeper) => {
        getNearbyPositions(sourceKeeper.pos, pathPolicy.sourceKeeperBuffer).forEach((pos) => {
          costMatrix.set(pos.x, pos.y, 10);
        });
      });
    }

    // Add a buffer around the ccontroller
    if (room && pathPolicy.controllerBuffer > 0) {
      const controller = room.controller;
      if (controller && controller.my) {
        getNearbyPositions(controller.pos, pathPolicy.controllerBuffer).forEach((pos) => {
          costMatrix.set(pos.x, pos.y, 10);
        });
      }
    }

    return costMatrix;
  }
}

const applyRoomCallbackPolicy = (
  kingdom: Kingdom,
  roomEntry: RoomEntry,
  policy: RoomPolicy,
  trace: Tracer
): [boolean, string] => {
  const owner = roomEntry.controller?.owner;
  const ownerIsNotMe = owner !== 'ENETDOWN';
  const isFriendly = kingdom.config.friends.includes(owner)

  if (owner && ownerIsNotMe && policy.avoidFriendlyRooms && isFriendly) {
    return [false, 'friendly'];
  }

  if (owner && ownerIsNotMe && policy.avoidHostileRooms && !isFriendly) {
    return [false, 'hostile'];
  }

  if (owner && ownerIsNotMe && policy.avoidRoomsWithTowers && roomEntry.numTowers) {
    return [false, 'towers'];
  }

  if (policy.avoidRoomsWithKeepers && roomEntry.hasKeepers) {
    return [false, 'keepers'];
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

  //trace.log('room allowed', {roomName: roomEntry.id});

  return [true, 'good'];
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
