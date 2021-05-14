const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorHarvest = require('./behavior.harvest');
const behaviorMovement = require('./behavior.movement');

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

const selectNearbyLink = behaviorTree.leafNode(
  'select_nearby_link',
  (creep, trace, kingdom) => {
    // Favor near by stores
    let nearByLinks = creep.pos.findInRange(FIND_STRUCTURES, 8, {
      filter: (structure) => {
        if (structure.structureType !== STRUCTURE_LINK) {
          return false;
        }

        return structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
      },
    });
    nearByLinks = _.sortBy(nearByLinks, (structure) => {
      return creep.pos.getRangeTo(structure);
    });

    // If we have a target set the destination
    if (nearByLinks.length) {
      trace.log('selecting nearby link', {linkId: nearByLinks[0].id});
      behaviorMovement.setDestination(creep, nearByLinks[0].id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.log('did not find a nearby link');
    return FAILURE;
  },
);

const selectStorage = behaviorTree.leafNode(
  'select_storage',
  (creep, trace, kingdom) => {
    const room = kingdom.getRoomByName(creep.room.name);
    if (!room) {
      trace.log('unable to get creep org room', {roomName: creep.room.name});
      return FAILURE;
    }

    const energyReserve = room.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, false);
    if (energyReserve && energyReserve.store.getUsedCapacity(RESOURCE_ENERGY) >= 0) {
      trace.log('selecting reserve', {id: energyReserve.id});
      behaviorMovement.setDestination(creep, energyReserve.id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.log('did not find reserver with energy');
    return FAILURE;
  },
);

const selectContainer = behaviorTree.leafNode(
  'select_container',
  (creep, trace, kingdom) => {
    // If no nearby stores or the room lacks storage, try to get energy from the nearest container
    const containerInRoom = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType !== STRUCTURE_CONTAINER) {
          return false;
        }

        return structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
      },
    });
    if (containerInRoom) {
      trace.log('selecting container in room', {id: containerInRoom.id});
      behaviorMovement.setDestination(creep, containerInRoom.id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.log('did not find an energy source');
    return FAILURE;
  },
);

const selectMoveFill = (selector) => {
  return behaviorTree.sequenceNode(
    'fill_from_selector',
    [
      selector,
      behaviorMovement.moveToDestination(1),
      behaviorTree.leafNode(
        'fill_creep',
        (creep) => {
          return behaviorMovement.fillCreepFromDestination(creep);
        },
      ),
    ],
  );
};

const fillCreepFromSource = behaviorTree.sequenceNode(
  'fill_from_source',
  [
    behaviorHarvest.selectHarvestSource,
    behaviorHarvest.moveToHarvest,
    behaviorHarvest.harvest,
  ],
);

module.exports.getEnergy = behaviorTree.repeatUntilConditionMet(
  'get_energy_until_success',
  (creep, trace, kingdom) => {
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.log('creep free capacity', {freeCapacity});
    return creep.store.getFreeCapacity(RESOURCE_ENERGY) < 1;
  },
  behaviorTree.selectorNode(
    'select_and_fill_with_energy',
    [
      behaviorTree.leafNode('probe', (creep, trace) => {
        trace.log('probe');
        return FAILURE;
      }),
      selectMoveFill(selectNearbyLink),
      selectMoveFill(selectStorage),
      selectMoveFill(selectContainer),
      pickupDroppedEnergy,
      fillCreepFromSource,
    ],
  ),
);

module.exports.parkingLot = behaviorTree.leafNode(
  'parking_lot',
  (creep, trace, kingdom) => {
    const colony = kingdom.getCreepColony(creep);
    if (!colony) {
      trace.log('could not find creep colony');
      return FAILURE;
    }

    const room = colony.getPrimaryRoom();
    if (!room) {
      trace.log('could not find colony primary room');
      return FAILURE;
    }

    const parkingLot = room.getParkingLot();
    if (!parkingLot) {
      trace.log('could not find parking lot');
      return FAILURE;
    }

    if (creep.pos.inRangeTo(parkingLot, 1)) {
      trace.log('in range of parking lot');
      return FAILURE;
    }

    trace.log('moving to parking lot');

    creep.moveTo(parkingLot, {
      reusePath: 50,
      maxOps: 1500,
    });

    return FAILURE;
  },
);
