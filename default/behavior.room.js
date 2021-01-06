const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');

const behaviorStorage = require('./behavior.storage');
const behaviorHarvest = require('./behavior.harvest');

const pickupDroppedEnergy = behaviorTree.leafNode(
  'janitor',
  (creep) => {
    // Locate dropped resource close to creep
    const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 25, {
      filter: (r) => {
        return r.resourceType === RESOURCE_ENERGY;
      },
    });
    if (!resources.length) {
      return FAILURE;
    }

    const result = creep.pickup(resources[0]);
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
);

module.exports.getEnergy = behaviorTree.repeatUntilSuccess(
  'get_energy_until_success',
  behaviorTree.selectorNode(
    'moveToDestination',
    [
      behaviorStorage.fillCreepFromContainers,
      pickupDroppedEnergy,
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
