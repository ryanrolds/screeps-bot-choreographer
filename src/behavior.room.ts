import {getBasePrimaryRoom, getBaseSpawns, getCreepBase, getStructureWithResource} from './base';
import * as behaviorMovement from './behavior.movement';
import {MEMORY_DESTINATION, MEMORY_IDLE} from './constants.memory';
import {commonPolicy} from './constants.pathing_policies';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';

const selectNearbyLink = behaviorTree.leafNode(
  'select_nearby_link',
  (creep, trace, _kernal) => {
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
      trace.info('selecting nearby link', {linkId: nearByLinks[0].id});
      behaviorMovement.setDestination(creep, nearByLinks[0].id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.info('did not find a nearby link');
    return FAILURE;
  },
);

const selectStorageForDeposit = behaviorTree.leafNode(
  'select_storage',
  (creep, trace, kernel) => {
    const base = getCreepBase(kernel, creep);
    if (!base) {
      trace.error('No base config for creep');
      return FAILURE;
    }

    const energyReserve = getStructureWithResource(base, RESOURCE_ENERGY);
    if (energyReserve) {
      trace.info('selecting reserve', {id: energyReserve.id});
      behaviorMovement.setDestination(creep, energyReserve.id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.info('did not find reserve with energy', {roomName: creep.room.name});
    return FAILURE;
  },
);

const selectContainer = behaviorTree.leafNode(
  'select_container',
  (creep, trace, _kernel) => {
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
      trace.info('selecting container in room', {id: containerInRoom.id});
      behaviorMovement.setDestination(creep, containerInRoom.id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.info('did not find a container with energy');
    return FAILURE;
  },
);


const selectDroppedEnergy = behaviorTree.leafNode(
  'select_dropped_energy',
  (creep, trace, _kernel) => {
    const droppedEnergy = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: (resource) => {
        if (resource.resourceType !== RESOURCE_ENERGY) {
          return false;
        }

        return resource.amount > 0;
      },
    });

    if (droppedEnergy) {
      trace.info('selecting dropped energy in room', {id: droppedEnergy.id});
      behaviorMovement.setDestination(creep, droppedEnergy.id);
      return SUCCESS;
    }

    behaviorMovement.setDestination(creep, null);

    trace.info('did not find any dropped energy');
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

export const getSomeEnergy = behaviorTree.runUntilConditionMet(
  'get_some_energy_until_success',
  (creep, trace, _kernel) => {
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.info('creep free capacity', {freeCapacity});
    return creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
  },
  behaviorTree.selectorNode(
    'select_and_fill_with_energy',
    [
      selectMoveFill(selectNearbyLink),
      selectMoveFill(selectStorageForDeposit),
      selectMoveFill(selectContainer),
      selectMoveFill(selectDroppedEnergy),
    ],
  ),
);

export const getEnergy = behaviorTree.repeatUntilConditionMet(
  'get_energy_until_success',
  (creep, trace, _kernel) => {
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.info('creep free capacity', {freeCapacity});
    return creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0;
  },
  behaviorTree.selectorNode(
    'select_and_fill_with_energy',
    [
      selectMoveFill(selectStorageForDeposit),
      selectMoveFill(selectNearbyLink),
      selectMoveFill(selectContainer),
      selectMoveFill(selectDroppedEnergy),
    ],
  ),
);

export const parkingLot = behaviorTree.leafNode(
  'parking_lot',
  (creep, trace, kernel) => {
    const base = getCreepBase(kernel, creep);
    if (!base?.parking) {
      trace.error('no parking config for creep', {creepName: creep.name});
      return FAILURE;
    }

    let idle = creep.memory[MEMORY_IDLE];
    if (!idle) {
      idle = 1;
    } else {
      idle++;
    }
    creep.memory[MEMORY_IDLE] = idle;

    if (creep.pos.inRangeTo(base.parking, 1)) {
      trace.info('in range of parking lot');

      // TODO may move this to something cheaper
      const hasNuker = base.parking.lookFor(LOOK_STRUCTURES).find((structure) => {
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

    trace.info('moving to parking lot', {parkingLot: base.parking});

    const result = creep.moveTo(base.parking, {
      reusePath: 50,
      maxOps: 1500,
      ignoreCreeps: false,
    });
    if (result !== OK && result !== ERR_TIRED) {
      trace.info('could not move to parking lot', {
        result,
        parkingLot: base.parking,
        creepName: creep.name,
        pos: creep.pos,
      });
    }

    return FAILURE;
  },
);

export const recycleCreep = behaviorTree.leafNode(
  'recycle_creep',
  (creep, trace, kernel) => {
    const base = getCreepBase(kernel, creep);
    if (!base) {
      trace.error('could not find creep base', {name: creep.name, memory: creep.memory});
      creep.suicide();
      return FAILURE;
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.info('could not find base primary room');
      // it may be worth suiciding here, when do we have a base but can't see it?
      return FAILURE;
    }

    const spawns = getBaseSpawns(base);
    if (!spawns.length) {
      trace.warn('no spawns, suicide', {baseId: base.id});
      creep.suicide();
      return FAILURE;
    }

    const spawn = spawns[0];
    if (creep.pos.inRangeTo(spawn, 1)) {
      const result = spawn.recycleCreep(creep);
      trace.notice('recycled creep', {result});
      return RUNNING;
    }


    const result = creep.moveTo(spawn, {
      reusePath: 50,
      maxOps: 1500,
    });
    trace.info('moving to spawn', {result});
    return RUNNING;
  },
);

const sign = `Hi!`;

export const updateSign = behaviorTree.repeatUntilConditionMet(
  'check_sign',
  (creep, _trace, _kernel) => {
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
      behaviorMovement.moveToCreepMemory(MEMORY_DESTINATION, 1, false, 25, 1500),
      behaviorTree.leafNode(
        'set_sign',
        (creep, trace, _kernel) => {
          const result = creep.signController(creep.room.controller, sign);
          trace.info('set sign', {result});

          if (result === OK) {
            return SUCCESS;
          }

          return SUCCESS;
        },
      ),
    ],
  ),
);

