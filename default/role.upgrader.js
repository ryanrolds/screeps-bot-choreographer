const behaviorTree = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const behaviorRoom = require('./behavior.room');
const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');

const behavior = behaviorTree.sequenceNode(
  'hauler_root',
  [
    behaviorAssign.moveToRoom,
    behaviorRoom.getEnergy,
    behaviorTree.leafNode(
      'pick_room_controller',
      (creep) => {
        behaviorMovement.setDestination(creep, creep.room.controller.id);
        return behaviorTree.SUCCESS;
      },
    ),
    behaviorMovement.moveToDestination(3),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilSuccess(
      'upgrade_until_empty',
      behaviorTree.leafNode(
        'empty_creep',
        (creep) => {
          const destination = Game.getObjectById(creep.memory.destination);
          if (!destination) {
            return behaviorTree.FAILURE;
          }

          const result = creep.upgradeController(creep.room.controller);
          if (result == ERR_NOT_ENOUGH_RESOURCES) {
            return behaviorTree.SUCCESS;
          }
          if (result != OK) {
            return behaviorTree.FAILURE;
          }
          if (creep.store.getUsedCapacity() === 0) {
            return behaviorTree.SUCCESS;
          }

          return behaviorTree.RUNNING;
        },
      ),
    ),
  ],
);


module.exports = {
  run: (creep, trace, kingdom) => {
    const roleTrace = trace.begin('upgrader');

    const result = behavior.tick(creep, roleTrace, kingdom);
    if (result == behaviorTree.FAILURE) {
      console.log('INVESTIGATE: upgrader failure', creep.name);
    }

    roleTrace.end();
  },
};
