import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING, NodeTickResult} from "./lib.behaviortree";

import * as MEMORY from "./constants.memory";
import {MEMORY_ORIGIN, MEMORY_SOURCE} from "./constants.memory";
import {PathCache, PathCacheItem} from "./lib.path_cache";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {FindPathPolicy} from "./lib.pathing";
import {common} from "./lib.pathing_policies";

const MAX_POSITION_TTL = 5;
const MEMORY_MOVE_POS_TTL = 'move_pos_ttl';
const MEMORY_MOVE_PREV_POS = 'move_prev_pos';

const PATH_ORIGIN_KEY = 'path_origin_id';
const PATH_DESTINATION_KEY = 'path_dest_key';

const getMoveOpts = (ignoreCreeps: boolean = false, reusePath: number = 100, maxOps: number = 2000,
  range: number = 0): MoveToOpts => {
  return {reusePath, maxOps, ignoreCreeps, range};
};

const moveToMemory = (creep: Creep, memoryId: any, range: number,
  ignoreCreeps: number, reusePath: number, maxOps: number) => {
  const destination = Game.getObjectById<Id<_HasRoomPosition>>(creep.memory[memoryId]);
  if (!destination) {
    return FAILURE;
  }

  return moveTo(creep, destination.pos, range, ignoreCreeps, reusePath, maxOps);
};

export const moveTo = (creep: Creep, destination: RoomPosition, range, ignoreCreeps,
  reusePath, maxOps): NodeTickResult => {
  if (creep.pos.inRangeTo(destination, range)) {
    return SUCCESS;
  }

  const moveOpts = getMoveOpts(ignoreCreeps, reusePath, maxOps, range);
  const result = creep.moveTo(destination, moveOpts);

  if (result === ERR_NO_PATH) {
    // Clear existing path so we build a new one
    delete creep.memory['_move'];
    return RUNNING;
  }

  if (result !== OK && result !== ERR_TIRED) {
    return FAILURE;
  }

  return RUNNING;
};

export const moveToRoom = (creep: Creep, room: string, ignoreCreeps: boolean,
  reusePath: number, maxOps: number): NodeTickResult => {
  const opts = getMoveOpts(ignoreCreeps, reusePath, maxOps);
  const result = creep.moveTo(new RoomPosition(25, 25, room), opts);
  if (result === ERR_NO_PATH) {
    return FAILURE;
  }

  return RUNNING;
};

export const setSource = (creep: Creep, sourceId: string) => {
  creep.memory[MEMORY_SOURCE] = sourceId;
};

export const moveToSource = (creep, range, ignoreCreeps, reusePath, maxOps) => {
  return moveToMemory(creep, MEMORY_SOURCE, range, ignoreCreeps, reusePath, maxOps);
};

export const clearSource = (creep) => {
  delete creep.memory[MEMORY_SOURCE];
};

export const setDestination = (creep, destinationId, roomId = null, shardName = null) => {
  creep.memory[MEMORY.MEMORY_DESTINATION] = destinationId;

  if (roomId) {
    creep.memory[MEMORY.MEMORY_DESTINATION_ROOM] = roomId;
  }

  if (!shardName) {
    shardName = Game.shard.name;
  }

  creep.memory[MEMORY.MEMORY_DESTINATION_SHARD] = shardName;
};

export const isStuck = (creep) => {
  let prevPos = creep.memory[MEMORY_MOVE_PREV_POS] || null;
  if (prevPos != null) {
    prevPos = new RoomPosition(prevPos.x, prevPos.y, prevPos.roomName);
  }

  // Compare current and last and increase stuck ttl
  if (prevPos && creep.pos.isEqualTo(prevPos)) {
    if (!creep.memory[MEMORY_MOVE_POS_TTL]) {
      creep.memory[MEMORY_MOVE_POS_TTL] = 0;
    }

    creep.memory[MEMORY_MOVE_POS_TTL] += 1;

    // Creep is stuck, clear cached path, and get new path factoring in creeps
    if (creep.memory[MEMORY_MOVE_POS_TTL] > MAX_POSITION_TTL) {
      clearMovementCache(creep);
      return true;
    }
  } else {
    // Creep is not stuck, update previous position and clear ttl
    creep.memory[MEMORY_MOVE_PREV_POS] = creep.pos;
    creep.memory[MEMORY_MOVE_POS_TTL] = 0;
  }

  return false;
};

const getDestinationFromPosInMemory = (creep: Creep, memoryId: string): RoomPosition => {
  const positionString = creep.memory[memoryId];
  if (!positionString) {
    return null;
  }

  const posArray = positionString.split(',');
  if (!posArray || posArray.length !== 3) {
    return null;
  }

  return new RoomPosition(posArray[0], posArray[1], posArray[2]);
}

const getDestinationFromMemory = (creep: Creep, memoryId: string): RoomPosition => {
  const destId = creep.memory[memoryId];
  if (!destId) {
    return null;
  }

  const dest: any = Game.getObjectById(destId);
  if (!dest) {
    return null;
  }

  return dest.pos;
};

const getAndSetCreepPath = (pathCache: PathCache, creep: Creep, destination: RoomPosition,
  range: number, policy: FindPathPolicy, trace: Tracer): [PathFinderPath, string, string] => {
  const path = pathCache.getPath(creep.pos, destination, range, policy, trace);
  const originKey = pathCache.getKey(creep.pos, 0);
  const destKey = pathCache.getKey(destination, range);

  return [path, originKey, destKey];
};

const clearMovementCache = (creep) => {
  delete creep.memory['_move'];
  delete creep.memory[PATH_ORIGIN_KEY];
  delete creep.memory[PATH_DESTINATION_KEY];
};

const updateCreepCachedPath = (kingdom: Kingdom, creep: Creep, destination: RoomPosition,
  range: number, policy: FindPathPolicy, trace: Tracer): PathFinderPath => {
  const pathCache = kingdom.getPathCache();

  let path: PathCacheItem = null;
  let originKey = creep.memory[PATH_ORIGIN_KEY] || null;
  let destKey = creep.memory[PATH_DESTINATION_KEY] || null;

  trace.log('keys', {originKey, destKey});

  if (originKey && destKey) {
    path = pathCache.getCachedPath(originKey, destKey, trace);
  }

  if (path) {
    trace.log('heap cache hit', {originKey, destKey});
    return path.value;
  }

  if (!path) {
    trace.log('heap cache miss', {originKey, destKey});
    const getSetResult = getAndSetCreepPath(pathCache, creep, destination, range, policy, trace);
    originKey = getSetResult[1];
    destKey = getSetResult[2];

    trace.log('setting keys', {originKey, destKey});

    creep.memory[PATH_ORIGIN_KEY] = originKey;
    creep.memory[PATH_DESTINATION_KEY] = destKey;

    return getSetResult[0];
  }

  trace.log('missing path', {originKey, destKey});
  clearMovementCache(creep);
  return null;
}

export const cachedMoveToMemoryPos = (memoryId: string, range: number = 1, policy: FindPathPolicy) => {
  return behaviorTree.leafNode(
    'cached_move_to_position',
    (creep, trace, kingdom) => {
      const destination = getDestinationFromPosInMemory(creep, memoryId);
      if (!destination) {
        clearMovementCache(creep);
        trace.log('missing destination', {memoryId});
        return FAILURE;
      }

      return cachedMoveToPosition(kingdom, creep, destination, range, policy, trace);
    },
  );
};

export const cachedMoveToMemoryObjectId = (memoryId: string, range: number = 1, policy: FindPathPolicy) => {
  return behaviorTree.leafNode(
    'cached_move_to_object_id',
    (creep, trace, kingdom) => {
      const destination = getDestinationFromMemory(creep, memoryId);
      if (!destination) {
        clearMovementCache(creep);
        trace.log('missing destination', {id: creep.memory[memoryId]});
        return FAILURE;
      }

      return cachedMoveToPosition(kingdom, creep, destination, range, policy, trace);
    },
  );
};

const cachedMoveToPosition = (kingdom: Kingdom, creep: Creep, destination: RoomPosition,
  range: number = 1, policy: FindPathPolicy, trace: Tracer) => {

  // Check if creep has arrived
  if (creep.pos.inRangeTo(destination, range)) {
    clearMovementCache(creep);
    trace.log('reached destination', {destination, range});
    return SUCCESS;
  }

  const stuck = isStuck(creep);

  let result: CreepMoveReturnCode | -5 | -10 | -2 | -7 = null;

  if (!stuck) {
    const pathfinderResult = updateCreepCachedPath(kingdom, creep, destination, range, policy, trace)
    trace.log('pathfinder result', {result: pathfinderResult, creepName: creep.name, destination, range, policy});
    if (!pathfinderResult) {
      trace.log('no path found', {destination, range});
      return FAILURE;
    }

    result = creep.moveByPath(pathfinderResult.path);
    trace.log('move by path result', {result, path: pathfinderResult.path});
  } else {
    const moveOpts = getMoveOpts(false, 50, policy.path.maxOps);
    result = creep.moveTo(destination, moveOpts);
    trace.log('stuck move result', {result, origin: creep.pos, destination});
  }

  if (result === ERR_NO_PATH) {
    // Clear existing path so we build a new one
    clearMovementCache(creep);
    trace.log('move by result no path', {result});
    return RUNNING;
  }

  if (result !== OK && result !== ERR_TIRED) {
    clearMovementCache(creep);
    trace.log('move by result not OK', {result});
    return FAILURE;
  }

  if (result === ERR_TIRED) {
    creep.memory[MEMORY_MOVE_POS_TTL] -= 1;
  }

  return RUNNING;
};

const deserializePath = (path) => {
  return path.map((position) => {
    return new RoomPosition(position.x, position.y, position.roomName);
  });
};

export const moveToCreepMemory = (memoryID, range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToCreepMemory',
    (creep) => {
      return moveToMemory(creep, memoryID, range, ignoreCreeps, reusePath, maxOps);
    },
  );
};

export const moveToDestination = (range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToDestination',
    (creep) => {
      return moveToMemory(creep, MEMORY.MEMORY_DESTINATION, range, ignoreCreeps, reusePath, maxOps);
    },
  );
};

export const clearDestination = (creep) => {
  delete creep.memory[MEMORY.MEMORY_DESTINATION];
  delete creep.memory[MEMORY.MEMORY_DESTINATION_POS];
  delete creep.memory[MEMORY.MEMORY_DESTINATION_ROOM];
  delete creep.memory[MEMORY.MEMORY_DESTINATION_SHARD];
};

export const fillCreepFromDestination = (creep, trace) => {
  const destinationMemory = creep.memory[MEMORY.MEMORY_DESTINATION];
  const destination = Game.getObjectById<Id<AnyStoreStructure>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
  if (!destination) {
    trace.log('could not find destination', {destinationMemory});
    return FAILURE;
  }

  const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] || RESOURCE_ENERGY;
  let amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] || undefined;

  if (amount > creep.store.getFreeCapacity(resource)) {
    amount = creep.store.getFreeCapacity(resource);
  }

  if (!destination.store) {
    trace.log('destination does not have a store');
    return FAILURE;
  }

  if (amount > destination.store.getUsedCapacity(resource)) {
    amount = destination.store.getUsedCapacity(resource);
  }

  if (amount === 0) {
    trace.log('amount is 0');
    return FAILURE;
  }

  // If we are seeing a specific amount, we are done when we have that amount in the hold
  if (amount && creep.store.getUsedCapacity(resource) >= amount) {
    trace.log('success: have amount we are looking for', {amount, resource});
    return SUCCESS;
  }

  const result = creep.withdraw(destination, resource, amount);
  trace.log('widthdrawl result', {result, destinationId: destination.id, resource, amount});
  if (result === OK) {
    return RUNNING;
  }
  if (result === ERR_FULL) {
    return SUCCESS;
  }
  if (result === ERR_NOT_ENOUGH_RESOURCES) {
    return SUCCESS;
  }

  return FAILURE;
};

export const moveToShard = (shardMemoryKey) => {
  return behaviorTree.repeatUntilConditionMet(
    'moveToShard',
    (creep, trace, kingdom) => {
      const destinationShardName = creep.memory[shardMemoryKey];
      // If creep doesn't have a harvest room assigned, we are done
      if (!destinationShardName) {
        return true;
      }

      // If the creep reaches the room we are done
      if (Game.shard.name === destinationShardName) {
        return true;
      }

      return false;
    },
    behaviorTree.sequenceNode(
      'select_and_enter_portal',
      [
        behaviorTree.leafNode(
          'select_portal',
          (creep, trace, kingdom) => {
            const destinationShardName = creep.memory[shardMemoryKey];

            // Lookup closest portal, use path cache
            let portals = kingdom.getScribe().getPortals(destinationShardName);
            if (!portals || !portals.length) {
              trace.log('unable to find portal', {shardName: destinationShardName});
              return FAILURE;
            }

            portals = _.filter(portals, (portal) => {
              return Game.map.getRoomLinearDistance(portal.pos.roomName, creep.room.name) < 4;
            });

            const portal = portals[0] || null;
            if (!portal) {
              trace.log('unable to find nearby portal', {shardName: destinationShardName});
              return FAILURE;
            }

            // Store creep and set portal as destination
            kingdom.getScribe().setCreepBackup(creep);
            creep.memory[MEMORY.MEMORY_DESTINATION_POS] = [portal.pos.x, portal.pos.y, portal.pos.roomName].join(',');

            return SUCCESS;
          },
        ),
        cachedMoveToMemoryPos(MEMORY.MEMORY_DESTINATION_POS, 0, common),
      ],
    ),
  );
};

export const moveToDestinationRoom = behaviorTree.repeatUntilSuccess(
  'bt.movement.moveToDestinationRoom',
  behaviorTree.leafNode(
    'move_to_exit',
    (creep) => {
      const room = creep.memory[MEMORY.MEMORY_DESTINATION_ROOM];
      // If creep doesn't have a harvest room assigned, we are done
      if (!room) {
        return SUCCESS;
      }

      // If the creep reaches the room we are done
      if (creep.room.name === room) {
        return SUCCESS;
      }

      const opts = getMoveOpts();
      const result = creep.moveTo(new RoomPosition(25, 25, room), opts);
      if (result === ERR_NO_PATH) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);

export const moveToOriginRoom = behaviorTree.repeatUntilSuccess(
  'goto_origin_room',
  behaviorTree.leafNode(
    'move_to_exit',
    (creep) => {
      const room = creep.memory[MEMORY_ORIGIN];
      // If creep doesn't have a harvest room assigned, we are done
      if (!room) {
        return SUCCESS;
      }

      // If the creep reaches the room we are done
      if (creep.room.name === room) {
        return SUCCESS;
      }

      const opts = getMoveOpts();
      const result = creep.moveTo(new RoomPosition(25, 25, room), opts);
      if (result === ERR_NO_PATH) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);
