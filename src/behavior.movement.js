const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const featureFlags = require('./lib.feature_flags');

const MEMORY = require('./constants.memory');
const {MEMORY_ORIGIN, MEMORY_SOURCE} = require('./constants.memory');

const MAX_POSITION_TTL = 5;
const MEMORY_MOVE_POS_TTL = 'move_pos_ttl';
const MEMORY_MOVE_PREV_POS = 'move_prev_pos';

const PATH_ORIGIN_KEY = 'path_origin_id';
const PATH_DESTINATION_KEY = 'path_dest_key';

const getMoveOpts = (ignoreCreeps = false, reusePath = 50, maxOps = 1500, range = 0) => {
  return {reusePath, maxOps, ignoreCreeps, range};
};

const moveToMemory = module.exports.moveToMemory = (creep, memoryId, range, ignoreCreeps,
  reusePath, maxOps) => {
  const destination = Game.getObjectById(creep.memory[memoryId]);
  if (!destination) {
    return FAILURE;
  }

  return moveTo(creep, destination, range, ignoreCreeps, reusePath, maxOps);
};

const moveTo = module.exports.moveTo = (creep, destination, range, ignoreCreeps,
  reusePath, maxOps) => {
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

module.exports.moveToRoom = (creep, room, ignoreCreeps, reusePath, maxOps) => {
  const opts = getMoveOpts(ignoreCreeps, reusePath, maxOps);
  const result = creep.moveTo(new RoomPosition(25, 25, room), opts);
  if (result === ERR_NO_PATH) {
    return FAILURE;
  }

  if (result === ERR_INVALID_ARGS) {
    return FAILURE;
  }

  return RUNNING;
};

module.exports.setSource = (creep, sourceId) => {
  creep.memory[MEMORY_SOURCE] = sourceId;
};

module.exports.moveToSource = (creep, range, ignoreCreeps, reusePath, maxOps) => {
  return moveToMemory(creep, MEMORY_SOURCE, range, ignoreCreeps, reusePath, maxOps);
};

module.exports.clearSource = (creep) => {
  delete creep.memory[MEMORY_SOURCE];
};

module.exports.setDestination = (creep, destinationId, roomId = null, shardName = null) => {
  creep.memory[MEMORY.MEMORY_DESTINATION] = destinationId;

  if (roomId) {
    creep.memory[MEMORY.MEMORY_DESTINATION_ROOM] = roomId;
  }

  if (!shardName) {
    shardName = Game.shard.name;
  }

  creep.memory[MEMORY.MEMORY_DESTINATION_SHARD] = shardName;
};

const isStuck = (creep) => {
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
module.exports.isStuck = isStuck;

const getDestination = (creep, memoryId) => {
  const destId = creep.memory[memoryId];
  if (!destId) {
    return null;
  }

  const dest = Game.getObjectById(destId);
  if (!dest) {
    return null;
  }

  return dest;
};

const getAndSetCreepPath = (pathCache, creep, memoryId, range, ignoreCreeps, trace) => {
  const destination = getDestination(creep, memoryId);
  if (!destination) {
    trace.log('missing or unknown destination', {memory: creep.memory});
    return [null, null, null];
  }

  const path = pathCache.getPath(creep.pos, destination.pos, range, ignoreCreeps);
  const originKey = pathCache.getKey(creep.pos, 0);
  const destKey = pathCache.getKey(destination.pos, range);

  return [path, originKey, destKey];
};

const clearMovementCache = (creep) => {
  delete creep.memory['_move'];
  delete creep.memory[PATH_ORIGIN_KEY];
  delete creep.memory[PATH_DESTINATION_KEY];
};

const moveByHeapPath = (memoryId, range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'move_by_heap_path',
    (creep, trace, kingdom) => {
      const destination = getDestination(creep, memoryId);
      if (!destination) {
        trace.log('missing or unknown destination', {memory: creep.memory});
        return FAILURE;
      }

      // Check if crepe has arrived
      if (creep.pos.inRangeTo(destination, range)) {
        clearMovementCache(creep);
        trace.log('reached destination', {id: destination.id, range});
        return SUCCESS;
      }

      const stuck = isStuck(creep);

      let moveResult = null;

      // If not stuck, use the cache
      if (!stuck) {
        const pathCache = kingdom.getPathCache();

        let path = null;
        let originKey = creep.memory[PATH_ORIGIN_KEY] || null;
        let destKey = creep.memory[PATH_DESTINATION_KEY] || null;
        if (originKey && destKey) {
          path = pathCache.getCachedPath(originKey, destKey);
        }

        if (!path) {
          trace.log('heap cache miss', {originKey, destKey});
          const getSetResult = getAndSetCreepPath(pathCache, creep, memoryId, range, true, trace);
          path = getSetResult[0];
          originKey = getSetResult[1];
          destKey = getSetResult[2];
        }

        if (!path) {
          trace.log('missing path', {originKey, destKey});
          clearMovementCache(creep);
          return FAILURE;
        }

        creep.memory[PATH_ORIGIN_KEY] = originKey;
        creep.memory[PATH_DESTINATION_KEY] = destKey;

        moveResult = creep.moveByPath(path.path);
        trace.log('move by path result', {moveResult, path: path.path});
      } else { // When stuck, use traditional move factoring in creeps
        // Honk at the guy blocking the road
        creep.say('Beep!');

        const moveOpts = getMoveOpts(false, 5, 500);
        moveResult = creep.moveTo(destination, moveOpts);
        trace.log('move to result', {moveResult});
      }

      if (moveResult === ERR_NO_PATH) {
        // Clear existing path so we build a new one
        clearMovementCache(creep);
        trace.log('move by result no path', {moveResult});
        return RUNNING;
      }

      if (moveResult !== OK && moveResult !== ERR_TIRED) {
        clearMovementCache(creep);
        trace.log('move by result not OK', {moveResult});
        return FAILURE;
      }

      if (moveResult === ERR_TIRED) {
        creep.memory[MEMORY_MOVE_POS_TTL] -= 1;
      }

      return RUNNING;
    },
  );
};
module.exports.moveByHeapPath = moveByHeapPath;

const cachedMoveToMemoryPos = (memoryId, range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'cached_move_to_position',
    (creep, trace, kingdom) => {
      const positionString = creep.memory[memoryId];
      if (!positionString) {
        return FAILURE;
      }

      const posArray = positionString.split(',');

      if (!posArray || posArray.length !== 3) {
        return FAILURE;
      }

      const destination = {
        pos: new RoomPosition(posArray[0], posArray[1], posArray[2]),
      };

      return cachedMoveToPosition(kingdom, creep, destination, range, ignoreCreeps,
        reusePath, maxOps, trace);
    },
  );
};
module.exports.cachedMoveToMemoryPos = cachedMoveToMemoryPos;

const cachedMoveToMemoryObjectId = (memoryId, range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'cached_move_to_object_id',
    (creep, trace, kingdom) => {
      const destination = Game.getObjectById(creep.memory[memoryId]);
      if (!destination) {
        delete creep.memory['_move'];
        delete creep.memory[MEMORY.PATH_CACHE];
        trace.log('missing destination', {id: creep.memory[memoryId]});
        return FAILURE;
      }

      return cachedMoveToPosition(kingdom, creep, destination, range, ignoreCreeps,
        reusePath, maxOps, trace);
    },
  );
};
module.exports.cachedMoveToMemoryObjectId = cachedMoveToMemoryObjectId;

const cachedMoveToPosition = (kingdom, creep, destination, range = 1, ignoreCreeps,
  reusePath, maxOps, trace) => {
  // Check if crepe has arrived
  if (creep.pos.inRangeTo(destination, range)) {
    delete creep.memory['_move'];
    delete creep.memory[MEMORY.PATH_CACHE];
    trace.log('reached destination', {id: destination.id, range});
    return SUCCESS;
  }

  ignoreCreeps = true;

  // Get last position
  let prevPos = creep.memory[MEMORY_MOVE_PREV_POS] || null;
  if (prevPos != null) {
    prevPos = new RoomPosition(prevPos.x, prevPos.y, prevPos.roomName);
  }

  // Compare current and last and increase stuck ttl
  let didMove = false;
  if (prevPos && creep.pos.isEqualTo(prevPos)) {
    if (!creep.memory[MEMORY_MOVE_POS_TTL]) {
      creep.memory[MEMORY_MOVE_POS_TTL] = 0;
    }

    creep.memory[MEMORY_MOVE_POS_TTL] += 1;

    // Creep is stuck, clear cached path, and get new path factoring in creeps
    if (creep.memory[MEMORY_MOVE_POS_TTL] > MAX_POSITION_TTL) {
      trace.log('creep stuck');
      delete creep.memory['_move'];
      delete creep.memory[MEMORY.PATH_CACHE];
      ignoreCreeps = false;
    }
  } else {
    // Creep is not stuck, update previous position and clear ttl
    creep.memory[MEMORY_MOVE_PREV_POS] = creep.pos;
    creep.memory[MEMORY_MOVE_POS_TTL] = 0;
    didMove = true;
  }

  let result = null;

  const useSerializedPath = featureFlags.getFlag(featureFlags.USE_SERIALIZED_PATH);
  const usePathCache = featureFlags.getFlag(featureFlags.USE_PATH_CACHE);
  if (usePathCache && ignoreCreeps) {
    let path = creep.memory[MEMORY.PATH_CACHE];
    if (!path) {
      trace.log('path cache miss');
      path = kingdom.getPathCache().getPath(creep.pos, destination.pos, range, ignoreCreeps);

      if (useSerializedPath) {
        creep.memory[MEMORY.PATH_CACHE] = path.serializedPath;
        path = path.serializedPath;
      } else {
        path = path.path;
        creep.memory[MEMORY.PATH_CACHE] = path;
      }
    } else {
      trace.log('path cache hit');
    }

    if (useSerializedPath) {
      if (didMove) {
        path = path.slice(1);
        creep.memory[MEMORY.PATH_CACHE] = path;
      }

      const direction = parseInt(path[0], 10);
      result = creep.move(direction);
    } else {
      path = deserializePath(path);
      result = creep.moveByPath(path);
    }

    trace.log('move by path result', {result, usePathCache, path});

    if (result === ERR_NOT_FOUND) {
      delete creep.memory['_move'];
      delete creep.memory[MEMORY.PATH_CACHE];

      return RUNNING;
    }
  } else {
    const moveOpts = getMoveOpts(ignoreCreeps, reusePath, maxOps);
    result = creep.moveTo(destination, moveOpts);
    trace.log('move result', {result});
  }

  if (result === ERR_NO_PATH) {
    // Clear existing path so we build a new one
    delete creep.memory['_move'];
    delete creep.memory[MEMORY.PATH_CACHE];

    trace.log('move by result no path', {result});

    return RUNNING;
  }

  if (result !== OK && result !== ERR_TIRED) {
    delete creep.memory['_move'];
    delete creep.memory[MEMORY.PATH_CACHE];

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

module.exports.moveToCreepMemory = (memoryID, range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToCreepMemory',
    (creep) => {
      return moveToMemory(creep, memoryID, range, ignoreCreeps, reusePath, maxOps);
    },
  );
};

module.exports.moveToDestination = (range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToDestination',
    (creep) => {
      return moveToMemory(creep, MEMORY.MEMORY_DESTINATION, range, ignoreCreeps, reusePath, maxOps);
    },
  );
};

module.exports.clearDestination = (creep) => {
  delete creep.memory[MEMORY.MEMORY_DESTINATION];
  delete creep.memory[MEMORY.MEMORY_DESTINATION_POS];
  delete creep.memory[MEMORY.MEMORY_DESTINATION_ROOM];
  delete creep.memory[MEMORY.MEMORY_DESTINATION_SHARD];
};

module.exports.fillCreepFromDestination = (creep) => {
  const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
  if (!destination) {
    return FAILURE;
  }

  const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] || RESOURCE_ENERGY;
  let amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] || undefined;

  if (amount > creep.store.getFreeCapacity(resource)) {
    amount = creep.store.getFreeCapacity(resource);
  }

  // TODO address
  /*
  [7:09:13 PM][shard3]TypeError: Cannot read property 'getUsedCapacity' of undefined
    at Object.module.exports.fillCreepFromDestination (behavior.movement:341:36)
    at Object.behavior (behavior.room:100:37)
    at Object.tick (lib.behaviortree:244:31)
    at Object.tickChildren (lib.behaviortree:79:42)
    at Object.tick (lib.behaviortree:94:31)
    at Object.tickChildren (lib.behaviortree:46:36)
    at Object.tick (lib.behaviortree:64:31)
    at Object.tick (lib.behaviortree:189:40)
    at Object.tickChildren (lib.behaviortree:79:42)
    */
  if (!destination.store) {
    return FAILURE;
  }

  if (amount > destination.store.getUsedCapacity(resource)) {
    amount = destination.store.getUsedCapacity(resource);
  }

  if (amount === 0) {
    return FAILURE;
  }

  // If we are seeing a specific amount, we are done when we have that amount in the hold
  if (amount && creep.store.getUsedCapacity(resource) >= amount) {
    return SUCCESS;
  }

  result = creep.withdraw(destination, resource, amount);
  if (result === OK) {
    return RUNNING;
  }
  if (result === ERR_FULL) {
    return SUCCESS;
  }
  if (result === ERR_NOT_ENOUGH_RESOURCES) {
    return FAILURE;
  }

  return FAILURE;
};

module.exports.moveToShard = (shardMemoryKey) => {
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
        cachedMoveToMemoryPos(MEMORY.MEMORY_DESTINATION_POS, 0, true, 50, 2500),
      ],
    ),
  );
};

module.exports.moveToDestinationRoom = behaviorTree.repeatUntilSuccess(
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

      if (result === ERR_INVALID_ARGS) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);

module.exports.moveToOriginRoom = behaviorTree.repeatUntilSuccess(
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

      if (result === ERR_INVALID_ARGS) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);
