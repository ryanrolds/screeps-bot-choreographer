import {getBasePrimaryRoom, getCreepBase, getStructuresWithResource} from './base';
import * as behaviorMovement from './behavior.movement';
import {WORKER_DISTRIBUTOR, WORKER_HAULER} from './constants.creeps';
import {MEMORY_DESTINATION, MEMORY_HAUL_DROPOFF, MEMORY_ROLE} from './constants.memory';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';

const spawnContainerCache: Map<string, (StructureContainer | StructureStorage)[]> = new Map();

export const selectEnergyForWithdraw = behaviorTree.leafNode(
  'selectEnergyForWithdraw',
  (creep, trace, kernel) => {
    const spawnContainers = spawnContainerCache.get(creep.room.name);
    if (!spawnContainers?.length || Game.time % 20 === 0) {
      const spawns = creep.room.find<StructureContainer>(FIND_STRUCTURES, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_SPAWN;
        },
      });

      const spawnContainers = _.reduce(spawns, (acc, spawn) => {
        const containers = spawn.pos.findInRange<StructureStorage | StructureContainer>(FIND_STRUCTURES, 8, {
          filter: (structure) => {
            return (structure.structureType == STRUCTURE_CONTAINER ||
              structure.structureType == STRUCTURE_STORAGE) &&
              structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        return acc.concat(containers);
      }, [] as (StructureContainer | StructureStorage)[]);

      spawnContainerCache[creep.room.name] = spawnContainers;
    }

    const target = creep.pos.findClosestByRange(spawnContainers);
    if (!target) {
      return FAILURE;
    }

    behaviorMovement.setDestination(creep, target.id, Game.time % 100);
    return SUCCESS;
  },
);

export const selectRoomDropoff = behaviorTree.selectorNode(
  'selectRoomDropoff',
  [
    behaviorTree.leafNode(
      'use_memory_dropoff',
      (creep) => {
        const dropoff = creep.memory[MEMORY_HAUL_DROPOFF];
        if (dropoff) {
          behaviorMovement.setDestination(creep, dropoff);
          return SUCCESS;
        }

        return FAILURE;
      },
    ),
    behaviorTree.leafNode(
      'pick_adjacent_container',
      (creep, trace, kernel) => {
        const role = creep.memory[MEMORY_ROLE];
        // haulers should pick containers near the spawner
        // TODO this is hacky and feels bad
        if (role && (role === WORKER_DISTRIBUTOR || role === WORKER_HAULER)) {
          return FAILURE;
        }

        const targets = creep.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTAINER &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
              structure.isActive();
          },
        });

        if (!targets || !targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_adjacent_link',
      (creep, trace, kernel) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const targets = creep.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: (structure) => {
            // TODO things seeking to gain energy should use another function
            return structure.structureType == STRUCTURE_LINK &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
              structure.isActive();
          },
        });

        if (!targets || !targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_storage',
      (creep, trace, kernel) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('could not find creep colony', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        const room = getBasePrimaryRoom(base);
        if (!room) {
          return FAILURE;
        }

        if (!room.storage || !room.storage?.isActive()) {
          return FAILURE;
        }

        const baseCreeps = kernel.getCreepsManager().getCreepsByBase(base.id);
        const distributors = _.filter(baseCreeps, (creep) => {
          return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR;
        });

        if (!distributors.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, room.storage.id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_tower',
      (creep, trace, kernel) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const targets = creep.room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return structure.structureType == STRUCTURE_TOWER &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
              structure.isActive();
          },
        });

        if (!targets || !targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_container',
      (creep, trace, kernel) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('could not find creep colony', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        const room = getBasePrimaryRoom(base);
        if (!room) {
          trace.error('could not find primary room', {baseId: base.id, roomName: base.primary});
          creep.suicide();
          return FAILURE;
        }

        const distributors = room.find(FIND_MY_CREEPS, {
          filter: (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR;
          },
        });

        if (!distributors.length) {
          return FAILURE;
        }

        const target = getStructuresWithResource(base, RESOURCE_ENERGY);
        if (!target.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, target[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_spawner_extension',
      (creep, trace, kernel) => {
        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('could not find creep colony', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        const room = getBasePrimaryRoom(base);
        if (!room) {
          trace.error('could not find primary room', {baseId: base.id, roomName: base.primary});
          creep.suicide();
          return FAILURE;
        }

        const targets = room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return (structure.structureType == STRUCTURE_EXTENSION ||
              structure.structureType == STRUCTURE_SPAWN) &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        if (!targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
  ],
);

export const fillCreep = behaviorTree.sequenceNode(
  'energy_supply',
  [
    selectEnergyForWithdraw,
    behaviorMovement.moveToCreepMemory(MEMORY_DESTINATION, 1, false, 100, 2000),
    behaviorTree.leafNode(
      'fill_creep',
      (creep, trace) => {
        return behaviorMovement.fillCreepFromDestination(creep, trace);
      },
    ),
  ],
);

export const fillCreepFrom = (from) => {
  return behaviorTree.sequenceNode(
    `fill_creep_from_${from}`,
    [
      from,
      behaviorMovement.moveToCreepMemory(MEMORY_DESTINATION, 1, false, 100, 2000),
      behaviorTree.leafNode(
        'fill_creep_from_destination',
        (creep, trace) => {
          return behaviorMovement.fillCreepFromDestination(creep, trace);
        },
      ),
    ],
  );
};

export const emptyCreep = behaviorTree.repeatUntilConditionMet(
  'transfer_until_empty',
  (creep, trace, kernel) => {
    if (creep.store.getUsedCapacity() === 0) {
      return true;
    }

    return false;
  },
  behaviorTree.sequenceNode(
    'dump_energy',
    [
      selectRoomDropoff,
      behaviorMovement.moveToDestinationRoom,
      behaviorMovement.moveToCreepMemory(MEMORY_DESTINATION, 1, false, 100, 2000),
      behaviorTree.leafNode(
        'empty_creep',
        (creep, trace, kernel) => {
          if (creep.store.getUsedCapacity() === 0) {
            return SUCCESS;
          }

          const destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION]) as AnyStoreStructure;
          if (!destination) {
            trace.info('no dump destination', {});
            return FAILURE;
          }

          const resource = Object.keys(creep.store).pop() as ResourceConstant;

          const result = creep.transfer(destination, resource);
          trace.log('transfer result', {
            result,
          });

          if (result === ERR_FULL) {
            return SUCCESS;
          }

          if (result === ERR_NOT_ENOUGH_RESOURCES) {
            return SUCCESS;
          }

          if (result === ERR_INVALID_TARGET) {
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
);

