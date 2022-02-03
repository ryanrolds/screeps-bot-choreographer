const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const {MEMORY_DESTINATION, MEMORY_IDLE} = require('./constants.memory');
const {commonPolicy} = require('./lib.pathing_policies');

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

    trace.log('did not find reserve with energy', {roomName: creep.room.name});
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

    trace.log('did not find a container with energy');
    return FAILURE;
  },
);


const selectDroppedEnergy = behaviorTree.leafNode(
  'select_dropped_energy',
  (creep, trace, kingdom) => {
    const droppedEnergy = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: (resource) => {
        if (resource.resourceType !== RESOURCE_ENERGY) {
          return false;
        }

        return resource.amount > 0;
      },
    });

    if (droppedEnergy) {
      trace.log('selecting dropped energy in room', {id: droppedEnergy.id});
      behaviorMovement.setDestination(creep, droppedEnergy.id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.log('did not find any dropped energy');
    return FAILURE;
  },
);

const selectMoveFill = (selector) => {
  return behaviorTree.sequenceNode(
    'fill_from_selector',
    [
      selector,
      behaviorMovement.cachedMoveToMemoryObjectId(MEMORY_DESTINATION, 1, commonPolicy),
      behaviorTree.leafNode(
        'fill_creep',
        (creep, trace) => {
          return behaviorMovement.fillCreepFromDestination(creep, trace);
        },
      ),
    ],
  );
};
module.exports.selectMoveFill = selectMoveFill;

/* TODO remove Jan 2020
const fillCreepFromSource = behaviorTree.sequenceNode(
  'fill_from_source',
  [
    behaviorHarvest.selectHarvestSource,
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY_SOURCE, 1, commonPolicy),
    behaviorHarvest.harvest,
  ],
);
*/

module.exports.getSomeEnergy = behaviorTree.runUntilConditionMet(
  'get_some_energy_until_success',
  (creep, trace, kingdom) => {
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.log('creep free capacity', {freeCapacity});
    return creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
  },
  behaviorTree.selectorNode(
    'select_and_fill_with_energy',
    [
      selectMoveFill(selectNearbyLink),
      selectMoveFill(selectStorage),
      selectMoveFill(selectContainer),
      selectMoveFill(selectDroppedEnergy),
    ],
  ),
);

module.exports.getEnergy = behaviorTree.repeatUntilConditionMet(
  'get_energy_until_success',
  (creep, trace, kingdom) => {
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.log('creep free capacity', {freeCapacity});
    return creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0;
  },
  behaviorTree.selectorNode(
    'select_and_fill_with_energy',
    [
      selectMoveFill(selectStorage),
      selectMoveFill(selectNearbyLink),
      selectMoveFill(selectContainer),
      selectMoveFill(selectDroppedEnergy),
    ],
  ),
);

module.exports.parkingLot = behaviorTree.leafNode(
  'parking_lot',
  (creep, trace, kingdom) => {
    const baseConfig = kingdom.getCreepBaseConfig(creep);
    if (!baseConfig?.parking) {
      trace.error('no parking config for creep', {creepName: creep.name});
      return FAILURE;
    }

    const idle = creep.memory[MEMORY_IDLE];
    if (!idle) {
      idle = 1;
    } else {
      idle++;
    }
    creep.memory[MEMORY_IDLE] = idle;

    if (creep.pos.inRangeTo(baseConfig.parking, 1)) {
      trace.log('in range of parking lot');

      // TODO may move this to something cheaper
      const hasNuker = baseConfig.parking.lookFor(LOOK_STRUCTURES).find((structure) => {
        return structure.structureType === STRUCTURE_NUKER;
      });

      // Pray to the God of Nukes
      if (idle % 20 === 0) {
        if (hasNuker) {
          creep.say('🙏');
        } else {
          creep.say('🥪');
        }
      }

      return FAILURE;
    }

    trace.log('moving to parking lot', {parkingLot: baseConfig.parking});

    const result = creep.moveTo(baseConfig.parking, {
      reusePath: 50,
      maxOps: 1500,
    });
    if (result !== OK && result !== ERR_TIRED) {
      trace.error('could not move to parking lot', {result, parkingLot: baseConfig.parking});
    }

    return FAILURE;
  },
);

module.exports.recycleCreep = behaviorTree.leafNode(
  'recycle_creep',
  (creep, trace, kingdom) => {
    const colony = kingdom.getCreepColony(creep);
    if (!colony) {
      trace.error('could not find creep colony', {name: creep.name, memory: creep.memory});
      creep.suicide();
      return FAILURE;
    }

    const room = colony.getPrimaryRoom();
    if (!room) {
      trace.log('could not find colony primary room');
      return FAILURE;
    }

    const spawns = room.getSpawns();
    if (!spawns.length) {
      trace.log('could not find spawns');
      return FAILURE;
    }

    const spawn = spawns[0];
    if (creep.pos.inRangeTo(spawn, 1)) {
      const result = spawn.recycleCreep(creep);
      trace.notice('recycled creep', {result});
      return RUNNING;
    }

    trace.log('moving to spawn');

    creep.moveTo(spawn, {
      reusePath: 50,
      maxOps: 1500,
    });

    return RUNNING;
  },
);

const sign = `Not friendly. Recall your AI. Train your AI before it's off leash!`;

module.exports.updateSign = behaviorTree.repeatUntilConditionMet(
  'check_sign',
  (creep, trace, kingdom) => {
    if (!creep.room || !creep.room.controller || !creep.room.controller.sign) {
      return true;
    }

    const current = creep.room.controller.sign.text;

    if (current.indexOf('Respawn Area') !== -1) {
      return true;
    }

    return current === sign;
  },
  behaviorTree.sequenceNode(
    'update_sign',
    [
      behaviorTree.leafNode(
        'pick_room_controller',
        (creep) => {
          behaviorMovement.setDestination(creep, creep.room.controller.id);
          return SUCCESS;
        },
      ),
      behaviorMovement.moveToDestination(1, false, 25, 1500),
      behaviorTree.leafNode(
        'set_sign',
        (creep, trace, kingdom) => {
          const result = creep.signController(creep.room.controller, sign);
          trace.log('set sign', {result});

          if (result === OK) {
            return SUCCESS;
          }

          return SUCCESS;
        },
      ),
    ],
  ),
);
