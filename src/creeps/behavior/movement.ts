import * as MEMORY from '../../constants/memory';
import {MEMORY_SOURCE} from '../../constants/memory';
import {commonPolicy} from '../../constants/pathing_policies';
import {FindPathPolicy, visualizePath} from '../../lib/pathing';
import {PathCache, PathCacheItem} from '../../lib/path_cache';
import {Tracer} from '../../lib/tracing';
import {Kernel} from '../../os/kernel/kernel';
import * as behaviorTree from './behaviortree';
import {FAILURE, NodeTickResult, RUNNING, SUCCESS} from './behaviortree';

const MAX_POSITION_TTL = 5;
const MEMORY_MOVE_POS_TTL = 'move_pos_ttl';
const MEMORY_MOVE_PREV_POS = 'move_prev_pos';
const MEMORY_MOVE_STUCK_COUNT = 'move_stuck_count';

const PATH_ORIGIN_KEY = 'path_origin_id';
const PATH_DESTINATION_KEY = 'path_dest_key';

const getMoveOpts = (ignoreCreeps = false, reusePath = 100, maxOps = 2000,
  range = 0): MoveToOpts => {
  return {reusePath, maxOps, ignoreCreeps, range};
};

const moveToMemory = (creep: Creep, memoryId: string, range: number,
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
  const wasStuck = creep.memory[MEMORY_MOVE_STUCK_COUNT] || 0;
  if (wasStuck > 0) {
    creep.memory[MEMORY_MOVE_STUCK_COUNT] = wasStuck - 1;
    return true;
  }

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
      creep.memory[MEMORY_MOVE_STUCK_COUNT] = 5;
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
};

const getDestinationFromMemory = (creep: Creep, memoryId: string): RoomPosition => {
  const destId = creep.memory[memoryId];
  if (!destId) {
    return null;
  }

  //
  const dest = Game.getObjectById(destId) as _HasRoomPosition;
  if (!dest) {
    return null;
  }

  return dest.pos;
};

const getAndSetCreepPath = (kernel: Kernel, pathCache: PathCache, creep: Creep, destination: RoomPosition,
  range: number, policy: FindPathPolicy, trace: Tracer): [PathFinderPath, string, string] => {
  const path = pathCache.getPath(kernel, creep.pos, destination, range, policy, trace);
  const originKey = pathCache.getKey(creep.pos, 0);
  const destKey = pathCache.getKey(destination, range);

  return [path, originKey, destKey];
};

const clearMovementCache = (creep) => {
  delete creep.memory['_move'];
  delete creep.memory[PATH_ORIGIN_KEY];
  delete creep.memory[PATH_DESTINATION_KEY];
};

const updateCreepCachedPath = (kernel: Kernel, creep: Creep, destination: RoomPosition,
  range: number, policy: FindPathPolicy, trace: Tracer): PathFinderPath => {
  const pathCache = kernel.getPathCache();

  let path: PathCacheItem = null;
  let originKey = creep.memory[PATH_ORIGIN_KEY] || null;
  let destKey = creep.memory[PATH_DESTINATION_KEY] || null;

  trace.info('keys', {originKey, destKey});

  if (originKey && destKey) {
    path = pathCache.getCachedPath(originKey, destKey, trace);
  }

  if (path) {
    trace.info('heap cache hit', {originKey, destKey});
    return path.value;
  }

  if (!path) {
    trace.info('heap cache miss', {originKey, destKey});
    const getSetResult = getAndSetCreepPath(kernel, pathCache, creep, destination, range, policy, trace);
    originKey = getSetResult[1];
    destKey = getSetResult[2];

    trace.info('setting keys', {originKey, destKey});

    creep.memory[PATH_ORIGIN_KEY] = originKey;
    creep.memory[PATH_DESTINATION_KEY] = destKey;

    return getSetResult[0];
  }

  trace.info('missing path', {originKey, destKey});
  clearMovementCache(creep);
  return null;
};

export const cachedMoveToMemoryPos = (memoryId: string, range = 1, policy: FindPathPolicy) => {
  return behaviorTree.leafNode(
    'cached_move_to_position',
    (creep, trace, kingdom) => {
      const destination = getDestinationFromPosInMemory(creep, memoryId);
      if (!destination) {
        clearMovementCache(creep);
        creep.say('📍❓');
        trace.error('missing creep destination', {memoryId});
        return FAILURE;
      }

      return cachedMoveToPosition(kingdom, creep, destination, range, policy, trace);
    },
  );
};

export const cachedMoveToRoom = (memoryId: string, policy: FindPathPolicy) => {
  return behaviorTree.leafNode(
    'cached_move_to_position',
    (creep, trace, kingdom) => {
      const destinationRoom = creep.memory[memoryId];
      if (!destinationRoom) {
        clearMovementCache(creep);
        creep.say('📍❓');
        trace.error('missing creep destination', {memoryId});
        return FAILURE;
      }

      if (creep.pos.roomName === destinationRoom) {
        return SUCCESS;
      }

      const destination = new RoomPosition(25, 25, destinationRoom);
      return cachedMoveToPosition(kingdom, creep, destination, 25, policy, trace);
    },
  );
};

export const cachedMoveToMemoryObjectId = (memoryId: string, range = 1, policy: FindPathPolicy) => {
  return behaviorTree.leafNode(
    'cached_move_to_object_id',
    (creep, trace, kingdom) => {
      const destination = getDestinationFromMemory(creep, memoryId);
      if (!destination) {
        clearMovementCache(creep);
        creep.say('📍❓');
        trace.error('missing creep destination', {id: creep.memory[memoryId]});
        return FAILURE;
      }

      return cachedMoveToPosition(kingdom, creep, destination, range, policy, trace);
    },
  );
};

const cachedMoveToPosition = (kernel: Kernel, creep: Creep, destination: RoomPosition,
  range = 1, policy: FindPathPolicy, trace: Tracer) => {
  // Check if creep has arrived
  if (creep.pos.inRangeTo(destination, range)) {
    clearMovementCache(creep);
    trace.info('reached destination', {destination, range});
    return SUCCESS;
  }

  const stuck = isStuck(creep);

  let result: CreepMoveReturnCode | -5 | -10 | -2 | -7 = null;

  if (!stuck) {
    const pathfinderResult = updateCreepCachedPath(kernel, creep, destination, range, policy, trace);
    trace.info('pathfinder result', {result: pathfinderResult, creepName: creep.name, destination, range, policy});
    if (!pathfinderResult) {
      creep.say('🚧');
      trace.error('no path found', {destination, range});
      return FAILURE;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((global as any).LOG_WHEN_PID === creep.name) {
      visualizePath(pathfinderResult.path, trace);
    }

    result = creep.moveByPath(pathfinderResult.path);
    trace.info('move by path result', {result, path: pathfinderResult.path});
  } else {
    const moveOpts = getMoveOpts(false, 50, policy.path.maxOps);
    result = creep.moveTo(destination, moveOpts);
    trace.info('stuck move result', {result, origin: creep.pos, destination});
  }

  if (result === ERR_NO_PATH) {
    // Clear existing path so we build a new one
    clearMovementCache(creep);
    trace.info('move by result no path', {result});
    return RUNNING;
  }

  if (result !== OK && result !== ERR_TIRED) {
    clearMovementCache(creep);
    creep.say('⛔️');
    trace.error('move by result not OK', {result});
    return FAILURE;
  }

  if (result === ERR_TIRED) {
    creep.memory[MEMORY_MOVE_POS_TTL] -= 1;
  }

  return RUNNING;
};

export const moveToCreepMemory = (memoryID, range = 1, ignoreCreeps, reusePath, maxOps) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToCreepMemory',
    (creep) => {
      return moveToMemory(creep, memoryID, range, ignoreCreeps, reusePath, maxOps);
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
    const result = creep.pickup(destination);
    if (result !== OK) {
      trace.error('failed to pick up resource', {result});
      return FAILURE;
    }

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
    (creep, _trace, _kingdom) => {
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
              trace.info('unable to find portal', {shardName: destinationShardName});
              return FAILURE;
            }

            portals = _.filter(portals, (portal) => {
              return Game.map.getRoomLinearDistance(portal.pos.roomName, creep.room.name) < 4;
            });

            const portal = portals[0] || null;
            if (!portal) {
              trace.info('unable to find nearby portal', {shardName: destinationShardName});
              return FAILURE;
            }

            // Store creep and set portal as destination
            kingdom.getScribe().setCreepBackup(creep);
            creep.memory[MEMORY.MEMORY_DESTINATION_POS] = [portal.pos.x, portal.pos.y, portal.pos.roomName].join(',');

            return SUCCESS;
          },
        ),
        cachedMoveToMemoryPos(MEMORY.MEMORY_DESTINATION_POS, 0, commonPolicy),
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
