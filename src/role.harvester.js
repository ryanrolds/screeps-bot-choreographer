const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorStorage = require('./behavior.storage');
const behaviorMovement = require('./behavior.movement');
const behaviorBuild = require('./behavior.build');
const behaviorHarvest = require('./behavior.harvest');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorBoosts = require('./behavior.boosts');
const MEMORY = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'haul_energy',
  [
    behaviorHarvest.moveToHarvestRoom,
    behaviorHarvest.moveToHarvest,
    behaviorCommute.setCommuteDuration,
    behaviorHarvest.harvest,
    behaviorTree.selectorNode(
      'dump_or_build',
      [
        behaviorTree.sequenceNode(
          'dump_energy',
          [
            behaviorStorage.selectRoomDropoff,
            behaviorMovement.moveToDestinationRoom,
            behaviorMovement.moveToDestination(1),
            behaviorTree.leafNode(
              'empty_creep',
              (creep) => {
                const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
                if (!destination) {
                  return FAILURE;
                }

                const resource = Object.keys(creep.store).pop();
                const result = creep.transfer(destination, resource);
                if (result === ERR_FULL) {
                  // We still have energy to transfer, fail so we find another
                  // place to dump
                  return FAILURE;
                }
                if (result === ERR_NOT_ENOUGH_RESOURCES) {
                  return SUCCESS;
                }
                if (creep.store.getUsedCapacity() === 0) {
                  return SUCCESS;
                }
                if (result != OK) {
                  return FAILURE;
                }

                return RUNNING;
              },
            ),
          ],
        ),
        behaviorTree.sequenceNode(
          'build_construction_site',
          [
            behaviorBuild.selectSite,
            behaviorMovement.moveToDestinationRoom,
            behaviorMovement.moveToDestination(1),
            behaviorBuild.build,
          ],
        ),
      ],
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(behaviorNonCombatant(behavior))),
};
