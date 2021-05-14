const behaviorTree = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');
const behaviorBoosts = require('./behavior.boosts');
const behaviorRoom = require('./behavior.room');

const MEMORY = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'upgrader_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorAssign.moveToRoom,
    behaviorRoom.getEnergy,
    behaviorTree.leafNode(
      'pick_room_controller',
      (creep) => {
        behaviorMovement.setDestination(creep, creep.room.controller.id);
        return behaviorTree.SUCCESS;
      },
    ),
    behaviorMovement.moveToDestination(3, false, 25, 1500),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilSuccess(
      'upgrade_until_empty',
      behaviorTree.leafNode(
        'upgrade_controller',
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

          return behaviorTree.RUNNING;
        },
      ),
    ),
  ],
);


module.exports = {
  run: behaviorTree.rootNode('upgrader', behaviorBoosts(behavior)),
};
