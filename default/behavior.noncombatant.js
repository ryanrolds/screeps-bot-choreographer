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

          if (!room.numHostiles) {
            return SUCCESS;
          }

          trace.log(creep.id, "numHostiles", room.numHostiles)

          const colony = kingdom.getCreepColony(creep);
          if (!colony) {
            return SUCCESS;
          }
          if (colony.primaryRoomId === room.id) {
            return SUCCESS;
          }

          const primaryRoom = colony.primaryRoom;
          return behaviorMovement.moveTo(creep, primaryRoom.controller, 3);
        },
      ),
      behaviorNode,
    ],
  );
};
