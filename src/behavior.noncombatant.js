const behaviorTree = require('./lib.behaviortree');
const {SUCCESS, RUNNING, FAILURE} = require('./lib.behaviortree');
const behaviorRoom = require('./behavior.room');

module.exports = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'non_combatant',
    [
      behaviorTree.selectorNode(
        'decide_to_flee_or_work',
        [
          behaviorTree.leafNode(
            'decide_to_flee',
            (creep, trace, kingdom) => {
              const colony = kingdom.getCreepColony(creep);
              if (!colony) {
                trace.log('could not find creep colony');
                return SUCCESS;
              }

              const room = kingdom.getCreepAssignedRoom(creep);
              if (!room) {
                trace.log('could not find creep assigned room');
                return SUCCESS;
              }

              if (colony.primaryRoomId === room.id) {
                trace.log('creep in primary room');
                return SUCCESS;
              }

              if (!room.isHostile(trace)) {
                trace.log('room is quiet');
                return SUCCESS;
              }

              trace.log('numHostiles', room.numHostiles);

              if (creep.pos.getRangeTo(colony.primaryRoom.controller) <= 3) {
                trace.log('creep near controller');
                return RUNNING;
              }

              trace.log('moving creep to primary room controller');
              return FAILURE;
            },
          ),
          behaviorRoom.parkingLot,
        ],
      ),
      behaviorNode,
    ],
  );
};
