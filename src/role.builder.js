const behaviorTree = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorMovement = require('./behavior.movement');
const behaviorBuild = require('./behavior.build');
const behaviorAssign = require('./behavior.assign');
const behaviorRoom = require('./behavior.room');
const behaviorBoosts = require('./behavior.boosts');
const behaviorNonCombatant = require('./behavior.noncombatant');

const MEMORY = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'builder_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorAssign.moveToRoom,
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.sequenceNode(
      'build_construction_site',
      [
        behaviorTree.selectorNode(
          'pick_something',
          [
            behaviorBuild.selectSite,
            behaviorRoom.parkingLot,
          ],
        ),
        behaviorMovement.moveToDestinationRoom,
        behaviorMovement.moveToDestination(1),
        behaviorBuild.build,
      ],
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('builder', behaviorBoosts(behaviorNonCombatant(behavior))),
};
