import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {Tracer} from "./lib.tracing";
import {Colony} from "./org.colony";
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

interface RoomCallbackFunc {
  (roomName: string): (boolean | CostMatrix);
}

export const getPath = (kingdom: Kingdom, origin: RoomPosition, destination: RoomPosition,
  policy: FindPathPolicy, trace: Tracer): PathFinderPath => {
  trace.notice('get path', {
    origin,
    destination,
    policy,
  });

  const result = PathFinder.search(origin, {
    pos: destination,
    range: policy.destination.range
  }, {
    maxRooms: policy.path.maxPathRooms,
    roomCallback: getRoomCallback(kingdom, policy.room, trace),
    maxOps: policy.path.maxOps,
    plainCost: policy.path.plainCost || 2,
    swampCost: policy.path.swampCost || 5,
  });

  trace.notice('path result', {result})

  if (!policy.path.allowIncomplete && result.incomplete) {
    trace.notice('path is incomplete', {result});
    return null;
  }

  return result;
}

export const getClosestColonyByPath = (kingdom: Kingdom, destination: RoomPosition,
  policy: FindColonyPathPolicy, trace: Tracer): Colony => {
  const roomEntry = kingdom.getScribe().getRoomById(destination.roomName);


  let selectedColony = null;
  let selectedPathLength = 99999;

  // Get colonies and filter by the policy
  let colonies = kingdom.getColonies();
  colonies = applyAllowedColonyPolicy(colonies, roomEntry, policy.colony, trace);
  // Iterate colonies and find the closest one within the policies
  colonies.forEach((colony) => {
    // Get the origin position from the colony by apply the colony policy
    const originPosition = getOriginPosition(kingdom, colony, policy.colony, trace);

    trace.notice('checking colony', {
      colony: colony.id,
      origin: originPosition,
      dest: destination,
      policy: policy.colony,
      roomEntry: roomEntry,
    });;

    // Find the path from the origin to the destination
    const result = getPath(kingdom, originPosition, destination, policy, trace);

    // If the path is longer then the current selection, skip
    if (result.path.length > selectedPathLength) {
      trace.notice('path is too long', {
        length: result.path.length,
        roomId: roomEntry.id,
        colonyId: colony.id,
      });
      return;
    }

    trace.notice('setting path', {
      length: result.path.length,
      roomId: roomEntry.id,
      colonyId: colony.id,
    })

    // Update the selected colony and path
    selectedColony = colony;
    selectedPathLength = result.path.length;
  });

  return selectedColony;
}

const applyAllowedColonyPolicy = (colonies: Colony[], destRoomEntry: RoomEntry, policy: ColonyPolicy,
  trace: Tracer): Colony[] => {
  if (policy.minRoomLevel) {
    trace.notice('applying min room level', {minRoomLevel: policy.minRoomLevel});
    colonies = colonies.filter((colony) => colony.primaryRoom?.controller?.level >= policy.minRoomLevel);
  }

  if (policy.maxLinearDistance) {
    // Narrow to linear distance to reduce the number of rooms to findRoute on
    trace.notice('applying linear distance filter', {maxLinearDistance: policy.maxLinearDistance});
    colonies = colonies.filter((colony) => {
      return Game.map.getRoomLinearDistance(destRoomEntry.id, colony.primaryRoomId) <= policy.maxLinearDistance;
    });
  }

  trace.notice('filtered colonies', {colonies: colonies.map((colony) => colony.id)});

  return colonies
}

const getOriginPosition = (kingdom: Kingdom, colony: Colony, policy: ColonyPolicy, trace: Tracer): RoomPosition => {
  if (policy.start === "spawn") {
    return colony.getSpawnPos();
  }

  return null;
}

const getRoomCallback = (kingdom: Kingdom, policy: RoomPolicy, trace: Tracer): RoomCallbackFunc => {
  return (roomName: string): (boolean | CostMatrix) => {
    const roomEntry = kingdom.getScribe().getRoomById(roomName);
    // If we have not scanned the room, dont enter it
    if (!roomEntry) {
      trace.notice('room not logged', {roomName});
      return false;
    }

    const allow = applyRoomCallbackPolicy(kingdom, roomEntry, policy, trace);
    if (!allow) {
      trace.notice('room not allowed', {roomName});
      return false;
    }

    return kingdom.getCostMatrixCache().getCostMatrix(roomName, policy.costMatrixType);
  }
}

const applyRoomCallbackPolicy = (kingdom: Kingdom, roomEntry: RoomEntry, policy: RoomPolicy, trace: Tracer): boolean => {
  const owner = roomEntry.controller?.owner;
  const ownerIsNotMe = owner !== 'ENETDOWN';
  const isFriendly = kingdom.config.friends.includes(owner)
  trace.notice('room owner', {roomId: roomEntry.id, owner, ownerIsNotMe, isFriendly});

  if (owner && ownerIsNotMe && policy.avoidFriendlyRooms && isFriendly) {
    trace.notice('room is friendly, avoid', {roomName: roomEntry.id, owner});
    return false;
  }

  if (owner && ownerIsNotMe && policy.avoidHostileRooms && !isFriendly) {
    trace.notice('room is hostile, avoid', {roomName: roomEntry.id, owner});
    return false;
  }

  if (policy.avoidRoomsWithKeepers && roomEntry.hasKeepers) {
    trace.notice('room has keepers, avoid', {roomName: roomEntry.id});
    return false;
  }

  if (policy.avoidRoomsWithTowers && roomEntry.numTowers) {
    trace.notice('room has towers, avoid', {roomName: roomEntry.id});
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

  return true;
}
