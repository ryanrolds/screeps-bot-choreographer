const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const {MEMORY_ASSIGN_ROOM} = require('./constants.memory');

const MEMORY_PREV_ROOM = 'previous_room';

const moveToRoom = behaviorTree.repeatUntilSuccess(
  'moveToAssignedRoom',
  behaviorTree.leafNode(
    'move_to_exit',
    (creep, trace, kingdom) => {
      const roomID = creep.memory[MEMORY_ASSIGN_ROOM];
      if (!roomID) {
        return SUCCESS;
      }

      const previousRoom = creep.memory[MEMORY_PREV_ROOM] || 'unknown';
      const currentRoom = creep.room.name;
      const changedRooms = currentRoom !== previousRoom;
      creep.memory[MEMORY_PREV_ROOM] = currentRoom;

      if (currentRoom === roomID && changedRooms) {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), {maxOps: 100});

        return SUCCESS;
      } else if (currentRoom === roomID) {
        return SUCCESS;
      }

      const result = creep.moveTo(new RoomPosition(25, 25, roomID), {
        reusePath: 50,
        maxOps: 500,
      });

      trace.log(creep.id, 'move to exit result', {
        result,
      });

      if (result === ERR_NO_PATH) {
        return RUNNING;
      }

      if (result === ERR_INVALID_ARGS) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);

const clearRoom = (creep) => {
  delete creep.memory[MEMORY_ASSIGN_ROOM];
};

module.exports = {
  moveToRoom,
  clearRoom,
};
