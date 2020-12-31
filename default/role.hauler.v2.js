
const behaviorTree = require('lib.behaviortree');
const behaviorMovement = require('behavior.movement');
const behaviorStorage = require('behavior.storage');
const {getEnergyContainerTargets} = require('helpers.targets');
const {MEMORY_WITHDRAW, MEMORY_DESTINATION} = require('constants.memory');

const behavior = behaviorTree.selectorNode(
  'hauler_root',
  [
    behaviorTree.sequenceNode(
      'haul_energy',
      [
        behaviorTree.repeatUntilSuccess(
          'withdraw_until_full',
          behaviorTree.sequenceNode(
            'get_energy',
            [
              behaviorTree.leafNode(
                'pick_supply',
                (creep) => {
                  if (creep.memory[MEMORY_WITHDRAW]) {
                    const container = Game.getObjectById(creep.memory[MEMORY_WITHDRAW]);
                    if (container) {
                      behaviorMovement.setDestination(creep, container.id);
                      return behaviorTree.SUCCESS;
                    }
                  }

                  const supply = getEnergyContainerTargets(creep);
                  if (!supply) {
                    return behaviorTree.FAILURE;
                  }

                  behaviorMovement.setDestination(creep, supply.id);

                  return behaviorTree.SUCCESS;
                },
              ),
              behaviorMovement.moveToDestination(1),
              behaviorTree.leafNode(
                'fill_creep',
                (creep) => {
                  const destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION]);
                  if (!destination) {
                    return behaviorTree.FAILURE;
                  }

                  const result = creep.withdraw(destination, RESOURCE_ENERGY);
                  if (result === ERR_FULL) {
                    return behaviorTree.SUCCESS;
                  }
                  if (result === ERR_NOT_ENOUGH_RESOURCES) {
                    return behaviorTree.FAILURE;
                  }
                  if (creep.store.getFreeCapacity() === 0) {
                    return behaviorTree.SUCCESS;
                  }
                  if (result === OK) {
                    return behaviorTree.RUNNING;
                  }

                  return behaviorTree.FAILURE;
                },
              ),
            ],
          ),
        ),
        behaviorStorage.emptyCreep,
      ],
    ),
  ],
);

module.exports = {
  run: (creep, trace) => {
    const roleTrace = trace.begin('hauler');

    const result = behavior.tick(creep, roleTrace);
    if (result == behaviorTree.FAILURE) {
      console.log('INVESTIGATE: hauler failure', creep.name);
    }

    roleTrace.end();
  },
};
