const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const {MEMORY_DESTINATION, MEMORY_DESTINATION_ROOM, MEMORY_ORIGIN,
  MEMORY_SOURCE} = require('./constants.memory');

const moveToMemory = module.exports.moveToMemory = (creep, memoryId, range) => {
  const destination = Game.getObjectById(creep.memory[memoryId]);
  if (!destination) {
    return FAILURE;
  }

  return moveTo(creep, destination, range);
};

const moveTo = module.exports.moveTo = (creep, destination, range) => {
  if (creep.pos.inRangeTo(destination, range)) {
    return SUCCESS;
  }

  const result = creep.moveTo(destination, {reusePath: 50, maxOps: 1000});
  if (result === ERR_NO_PATH) {
    // Clear existing path so we build a new one
    delete creep.memory["_move"]
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
  creep.memory[MEMORY_DESTINATION] = destinationId;

  if (roomId) {
    creep.memory[MEMORY_DESTINATION_ROOM] = roomId;
  }
};

module.exports.moveToCreepMemory = (memoryID, range = 1) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToCreepMemory',
    (creep) => {
      return moveToMemory(creep, memoryID, range);
    },
  );
};

module.exports.moveToDestination = (range = 1) => {
  return behaviorTree.leafNode(
    'bt.movement.moveToDestination',
    (creep) => {
      return moveToMemory(creep, MEMORY_DESTINATION, range);
    },
  );
};

module.exports.clearDestination = (creep) => {
  delete creep.memory[MEMORY_DESTINATION];
};

module.exports.fillCreepFromDestination = (creep) => {
  const destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION]);
  if (!destination) {
    return FAILURE;
  }

  const result = creep.withdraw(destination, RESOURCE_ENERGY);
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
      const room = creep.memory[MEMORY_DESTINATION_ROOM];
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
