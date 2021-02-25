const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');

const behaviorStorage = require('./behavior.storage');
const behaviorHarvest = require('./behavior.harvest');

const pickupDroppedEnergy = behaviorTree.leafNode(
  'janitor',
  (creep) => {
    if (creep.store.getFreeCapacity() === 0) {
      return SUCCESS;
    }

    // Locate dropped resource close to creep
    const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 25, {
      filter: (r) => {
        return r.resourceType === RESOURCE_ENERGY;
      },
    });
    if (!resources.length) {
      return FAILURE;
    }

    const resource = resources[0];

    if (!creep.pos.inRangeTo(resource, 1)) {
      creep.moveTo(resource), {
        reusePath: 25,
        maxOps: 500,
      };
      return RUNNING;
    }

    const result = creep.pickup(resource);
    if (result === ERR_FULL) {
      // We still have energy to transfer, fail so we find another
      // place to dump
      return FAILURE;
    }
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return SUCCESS;
    }
    if (creep.store.getFreeCapacity() === 0) {
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
    'containers_dropped_harvest',
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

module.exports.parkingLot = behaviorTree.leafNode(
  'parking_lot',
  (creep, trace, kingdom) => {
    const colony = kingdom.getCreepColony(creep);
    if (!colony) {
      return FAILURE;
    }

    const room = colony.getPrimaryRoom();
    if (!room) {
      return FAILURE;
    }

    const parkingLot = room.getParkingLot();
    if (!parkingLot) {
      return FAILURE;
    }

    if (creep.pos.inRangeTo(parkingLot, 1)) {
      return FAILURE;
    }

    creep.moveTo(parkingLot, {
      reusePath: 50,
      maxOps: 1500,
    });

    return FAILURE;
  },
);
