import {Base} from './base/base';
import {AllowedCostMatrixTypes} from './costmatrix_cache';
import {Kernel} from './kernel';
import {getNearbyPositions} from './position';
import {RoomEntry} from './runnable.scribe';
import {Tracer} from './tracing';

type BasePolicy = {
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
  hostileCreepBuffer?: number;
  controllerBuffer?: number;
  preferRoadSites?: boolean;
}

export type FindBasePathPolicy = {
  base: BasePolicy;
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
  searchedRooms: Set<string>;
  rejectedRooms: Map<string, string>;
  blockedRooms: Set<string>;
  incompletePaths: PathFinderPath[];
};

interface RouteCallback {
  (roomName: string, fromRoomName: string): number;
}

interface RoomCallbackFunc {
  (roomName: string): (boolean | CostMatrix);
}

type FindRouteRoom = {
  exit: ExitConstant;
  room: string;
};

type FindRouteResult = FindRouteRoom[] | -2;

export const getPath = (kernel: Kernel, origin: RoomPosition, destination: RoomPosition,
  policy: FindPathPolicy, trace: Tracer): [PathFinderPath, PathSearchDetails] => {
  const pathDetails: PathSearchDetails = {
    tries: 1,
    passes: 0,
    searchedRooms: new Set(),
    rejectedRooms: new Map(),
    blockedRooms: new Set(),
    incompletePaths: [],
  };

  for (; pathDetails.passes < pathDetails.tries; pathDetails.passes++) {
    // Get list of rooms on the way to destination
    const roomRoute: FindRouteResult = Game.map.findRoute(origin.roomName, destination.roomName, {
      routeCallback: getRoomRouteCallback(kernel, origin.roomName, destination.roomName,
        policy.room, pathDetails, trace),
    });

    // If we have no route, return null
    if (roomRoute === ERR_NO_PATH) {
      trace.info('no room path', {origin: origin.roomName, destination: destination.roomName});
      return [null, pathDetails];
    }

    // Map findRoute results to map of names for fast lookup
    const rooms = _.values<FindRouteRoom>(roomRoute);
    const allowedRooms: Map<string, boolean> = _.reduce(rooms, (acc, entry) => {
      acc.set(entry.room, true);
      return acc;
    }, new Map<string, boolean>());

    // Add origin room to list of allowed room
    allowedRooms.set(origin.roomName, true);

    const goal = {
      pos: destination,
      range: policy.destination.range,
    };

    const opts: PathFinderOpts = {
      maxRooms: policy.path.maxSearchRooms,
      roomCallback: getRoomCallback(kernel, origin.roomName, destination.roomName,
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
      pathDetails.blockedRooms.add(lastRoom);
      pathDetails.incompletePaths.push(result);
    }
  }

  trace.info('passes exhausted', {origin});
  return [null, pathDetails];
};

export const getClosestBaseByPath = (kernel: Kernel, destination: RoomPosition,
  policy: FindBasePathPolicy, trace: Tracer): Base => {
  const roomEntry = kernel.getScribe().getRoomById(destination.roomName);

  let selectedBase: Base = null;
  let selectedPathLength = 99999;

  // Get colonies and filter by the policy
  let bases = kernel.getPlanner().getBases();
  bases = applyAllowedBasePolicy(bases, roomEntry, policy.base, trace);
  // Iterate colonies and find the closest one within the policies
  bases.forEach((config) => {
    // Get the origin position from the base by apply the base policy
    const originPosition = getOriginPosition(kernel, config, policy.base, trace);
    if (!originPosition) {
      trace.error('no origin position', {config, policy});
      return;
    }

    // Find the path from the origin to the destination
    const [result, debug] = getPath(kernel, originPosition, destination, policy, trace);
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

    // Update the selected base and path
    selectedBase = config;
    selectedPathLength = result.path.length;
  });

  return selectedBase;
};

const applyAllowedBasePolicy = (bases: Base[], destRoomEntry: RoomEntry,
  policy: BasePolicy, trace: Tracer): Base[] => {
  // Do not search colonies below the minimum level
  if (policy.minRoomLevel) {
    bases = bases.filter((config) => {
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
    bases = bases.filter((config) => {
      return Game.map.getRoomLinearDistance(destRoomEntry.id, config.primary) <= policy.maxLinearDistance;
    });
  }

  trace.info('filtered colonies', {colonies: bases.map((base) => base.id)});

  return bases;
};

const getOriginPosition = (_kernel: Kernel, base: Base, policy: BasePolicy,
  _trace: Tracer): RoomPosition => {
  if (policy.start === 'spawn') {
    return base.origin;
  }

  return null;
};

const getRoomRouteCallback = (
  kernel: Kernel,
  originRoom: string,
  destRoom: string,
  policy: RoomPolicy,
  searchDetails: PathSearchDetails,
  trace: Tracer,
): RouteCallback => {
  return (toRoom: string, _fromRoom: string): number => {
    searchDetails.searchedRooms.add(toRoom);

    // Always allow entry to destination room
    if (destRoom === toRoom) {
      return 1;
    }

    // Always allow movement in origin room
    if (originRoom === toRoom) {
      return 1;
    }

    if (searchDetails.blockedRooms.has(toRoom)) {
      return Infinity;
    }

    const roomEntry = kernel.getScribe().getRoomById(toRoom);

    // If we have not scanned the room, dont enter it
    if (!roomEntry && policy.avoidUnloggedRooms) {
      return Infinity;
    }

    if (roomEntry) {
      const [allow, reason] = applyRoomCallbackPolicy(kernel, roomEntry, policy, trace);
      if (!allow) {
        searchDetails.rejectedRooms.set(toRoom, reason);
        return Infinity;
      }
    }

    return 1;
  };
};

const getRoomCallback = (
  kernel: Kernel,
  originRoom: string,
  destRoom: string,
  pathPolicy: PathPolicy,
  roomPolicy: RoomPolicy,
  allowedRooms: Map<string, boolean>,
  pathDetails: PathSearchDetails,
  trace: Tracer,
): RoomCallbackFunc => {
  return (roomName: string): (boolean | CostMatrix) => {
    // If this room is not destination, check if we should avoid it
    if (originRoom != roomName && destRoom !== roomName) {
      if (!allowedRooms.has(roomName)) {
        pathDetails.rejectedRooms.set(roomName, 'not in allowed rooms');
        return false;
      }

      const roomEntry = kernel.getScribe().getRoomById(roomName);

      // If we have not scanned the room, dont enter it
      if (!roomEntry && roomPolicy.avoidUnloggedRooms) {
        pathDetails.rejectedRooms.set(roomName, 'unlogged');
        return false;
      }

      if (roomEntry) {
        const [allow, reason] = applyRoomCallbackPolicy(kernel, roomEntry, roomPolicy, trace);
        if (!allow) {
          pathDetails.rejectedRooms.set(roomName, reason);
          return false;
        }
      }
    }

    // Fetch cached cost matrix for the room
    let costMatrix = kernel.getCostMatrixCache().getCostMatrix(kernel, roomName,
      roomPolicy.costMatrixType, trace);
    costMatrix = costMatrix.clone();

    const room = Game.rooms[roomName];
    if (room) {
      // Mark creeps as not passible
      if (!pathPolicy.ignoreCreeps) {
        room.find(FIND_CREEPS).forEach((creep) => {
          costMatrix.set(creep.pos.x, creep.pos.y, 255);
        });
      }

      // add road construction sites
      if (pathPolicy.preferRoadSites) {
        room.find(FIND_MY_CONSTRUCTION_SITES).forEach((site) => {
          if (site.structureType === STRUCTURE_ROAD) {
            costMatrix.set(site.pos.x, site.pos.y, 1);
          }
        });
      }

      // Add a buffer around source keepers
      if (pathPolicy.sourceKeeperBuffer > 0) {
        room.find(FIND_HOSTILE_CREEPS, {
          filter: (creep) => {
            return creep.owner.username === 'Source Keeper';
          },
        }).forEach((sourceKeeper) => {
          getNearbyPositions(sourceKeeper.pos, pathPolicy.sourceKeeperBuffer).forEach((pos) => {
            costMatrix.set(pos.x, pos.y, 10);
          });
        });
      }

      // Add a buffer around hostile creeps
      if (pathPolicy.hostileCreepBuffer > 0) {
        room.find(FIND_HOSTILE_CREEPS, {
          filter: (creep) => {
            return creep.owner.username !== 'Source Keeper';
          },
        }).forEach((hostileCreep) => {
          getNearbyPositions(hostileCreep.pos, pathPolicy.hostileCreepBuffer).forEach((pos) => {
            costMatrix.set(pos.x, pos.y, 10);
          });
        });
      }

      // Add a buffer around the controller
      if (pathPolicy.controllerBuffer > 0) {
        const controller = room.controller;
        if (controller && controller.my) {
          getNearbyPositions(controller.pos, pathPolicy.controllerBuffer).forEach((pos) => {
            costMatrix.set(pos.x, pos.y, 10);
          });
        }
      }
    }

    return costMatrix;
  };
};

const applyRoomCallbackPolicy = (
  kernel: Kernel,
  roomEntry: RoomEntry,
  policy: RoomPolicy,
  _trace: Tracer,
): [boolean, string] => {
  const owner = roomEntry.controller?.owner;
  const ownerIsNotMe = owner !== kernel.getPlanner().getUsername();
  const isFriendly = kernel.getFriends().includes(owner);

  // If owner is not me, and we want to avoid friendly rooms and is friendly, dont enter
  if (owner && ownerIsNotMe && policy.avoidFriendlyRooms && isFriendly) {
    return [false, 'friendly'];
  }

  // If owner is not me and has hostile creeps, dont enter
  if (owner && ownerIsNotMe && policy.avoidHostileRooms && !isFriendly && roomEntry.hasHostiles) {
    return [false, 'hostile'];
  }

  // if owner is not me and has towers, dont enter
  if (owner && ownerIsNotMe && policy.avoidRoomsWithTowers && !isFriendly && roomEntry.numTowers) {
    return [false, 'towers'];
  }

  // if has Keepers, dont enter
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

  // trace.info('room allowed', {roomName: roomEntry.id});

  return [true, 'good'];
};

export const visualizePath = (path: RoomPosition[], _trace: Tracer) => {
  const pathByRooms = path.reduce((acc, pos) => {
    if (!acc.has(pos.roomName)) {
      acc.set(pos.roomName, []);
    }

    acc.get(pos.roomName).push(pos);

    return acc;
  }, new Map<string, RoomPosition[]>());

  // Display in the rooms
  Array.from(pathByRooms.entries()).forEach(([key, value]) => {
    new RoomVisual(key).poly(value);
  });
};
