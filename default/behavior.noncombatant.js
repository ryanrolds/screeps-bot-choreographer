const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');

module.exports = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'non_combatant',
    [
      behaviorTree.leafNode(
        'flee_hostiles',
        (creep, trace, kingdom) => {
          const room = kingdom.getCreepRoom(creep);
          if (!room) {
            return SUCCESS;
          }

          const colony = kingdom.getCreepColony(creep);
          if (!colony) {
            return SUCCESS;
          }
          if (!colony.primaryRoom) {
            return SUCCESS;
          }

          const primaryRoom = colony.primaryRoom;

          if (!room.numHostiles || creep.room.name === primaryRoom.name) {
            return SUCCESS;
          }

          if (creep.room.name !== colony.primaryRoom.name) {
            const roomId = colony.primaryRoom.name;
            const result = creep.moveTo(new RoomPosition(25, 25, roomId));
            if (result === ERR_NO_PATH) {
              return FAILURE;
            }

            if (result === ERR_INVALID_ARGS) {
              return FAILURE;
            }

            return RUNNING;
          }

          return behaviorMovement.moveTo(creep, primaryRoom.controller, 1);
        },
      ),
      behaviorNode,
    ],
  );
};
