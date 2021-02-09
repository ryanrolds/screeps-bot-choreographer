const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const {MEMORY_DESTINATION, MEMORY_DESTINATION_ROOM, MEMORY_ORIGIN,
  MEMORY_SOURCE} = require('./constants.memory');

const MEMORY = require('./constants.memory');

const moveToMemory = module.exports.moveToMemory = (creep, memoryId, range, ignoreCreeps = false) => {
  const destination = Game.getObjectById(creep.memory[memoryId]);
  if (!destination) {
    return FAILURE;
  }

  /*
  let path = creep.memory[MEMORY.PATH_CACHE];
  if (!path) {
    path = pathCache.getPath(creep.pos, destination.pos)
    console.log("path cache", JSON.stringify(path))
  }

  if (path) {

  } else {

  }
  */

  return moveTo(creep, destination, range, ignoreCreeps);
};

const moveTo = module.exports.moveTo = (creep, destination, range, ignoreCreeps = false) => {
  if (creep.pos.inRangeTo(destination, range)) {
    return SUCCESS;
  }

  const moveOpts = {
    reusePath: 50,
    maxOps: 1000,
    ignoreCreeps,
  };

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

module.exports.moveToRoom = (creep, room) => {
  const result = creep.moveTo(new RoomPosition(25, 25, room));
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

module.exports.moveToSource = (creep, range) => {
  return moveToMemory(creep, MEMORY_SOURCE, range);
};

module.exports.clearSource = (creep) => {
  delete creep.memory[MEMORY_SOURCE];
};

module.exports.setDestination = (creep, destinationId, roomId = null) => {
  creep.memory[MEMORY.MEMORY_DESTINATION] = destinationId;

  if (roomId) {
    creep.memory[MEMORY.MEMORY_DESTINATION_ROOM] = roomId;
  }
};

module.exports.moveToCreepMemory = (memoryID, range = 1, ignoreCreeps = false) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToCreepMemory',
    (creep) => {
      return moveToMemory(creep, memoryID, range, ignoreCreeps);
    },
  );
};

module.exports.moveToDestination = (range = 1, ignoreCreeps = false) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToDestination',
    (creep) => {
      return moveToMemory(creep, MEMORY.MEMORY_DESTINATION, range, ignoreCreeps);
    },
  );
};

module.exports.clearDestination = (creep) => {
  delete creep.memory[MEMORY.MEMORY_DESTINATION];
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

      const result = creep.moveTo(new RoomPosition(25, 25, room));
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

      const result = creep.moveTo(new RoomPosition(25, 25, room));
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
