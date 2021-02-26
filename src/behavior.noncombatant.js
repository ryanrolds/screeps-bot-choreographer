const behaviorTree = require('./lib.behaviortree');
const {SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');

module.exports = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'non_combatant',
    [
      behaviorTree.leafNode(
        'flee_hostiles',
        (creep, trace, kingdom) => {
          const colony = kingdom.getCreepColony(creep);
          if (!colony) {
            return SUCCESS;
          }

          const room = kingdom.getCreepAssignedRoom(creep);
          if (!room) {
            return SUCCESS;
          }

          if (creep.room.name !== room.id) {
            const colony = kingdom.getCreepColony(creep);
            if (colony) {
              const creepRoom = colony.getRoomByID(creep.room.name);
              if (creepRoom) {
                room = creepRoom;
              }
            }
          }

          if (colony.primaryRoomId === room.id) {
            return SUCCESS;
          }

          if (!room.numHostiles) {
            return SUCCESS;
          }

          trace.log(creep.id, 'numHostiles', room.numHostiles);

          const primaryRoom = colony.primaryRoom;

          if (creep.pos.getRangeTo(primaryRoom.controller) <= 3) {
            return RUNNING;
          }

          return behaviorMovement.moveTo(creep, primaryRoom.controller, 3);
        },
      ),
      behaviorNode,
    ],
  );
};
