const behaviorTree = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const behaviorRoom = require('./behavior.room');
const behaviorHarvest = require('./behavior.harvest');
const behaviorStorage = require('./behavior.storage');
const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');
const MEMORY = require('./constants.memory')
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');


const fillCreepFromDestination = (creep) => {
  const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
  if (!destination) {
    return FAILURE;
  }

  const result = creep.withdraw(destination, RESOURCE_ENERGY);
  if (result === OK) {
    return RUNNING;
  }
  if (result === ERR_FULL) {
    return SUCCESS;
  }
  if (result === ERR_NOT_ENOUGH_RESOURCES) {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      return SUCCESS
    }


    return FAILURE;
  }

  return FAILURE;
};

const fillCreepFromContainers = behaviorTree.sequenceNode(
  'energy_supply_containers',
  [
    behaviorStorage.selectContainerForWithdraw,
    behaviorMovement.moveToDestination(1),
    behaviorTree.leafNode(
      'fill_creep',
      (creep) => {
        return fillCreepFromDestination(creep);
      },
    ),
  ],
);

const getEnergy = behaviorTree.repeatUntilSuccess(
  'get_energy_until_success',
  behaviorTree.selectorNode(
    'moveToDestination',
    [
      fillCreepFromContainers,
      behaviorTree.sequenceNode(
        'harvest_if_needed',
        [
          behaviorHarvest.selectHarvestSource,
          behaviorHarvest.moveToHarvest,
          behaviorHarvest.harvest,
        ],
      ),
    ],
  ),
);

const behavior = behaviorTree.sequenceNode(
  'hauler_root',
  [
    behaviorAssign.moveToRoom,
    getEnergy,
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
  id: 'upgrader',
  run: behaviorTree.rootNode(this.id, behavior).tick
};
