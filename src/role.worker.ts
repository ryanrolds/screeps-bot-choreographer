
/**
 * Worker creep
 *
 * Early game creep. Used when there is no storage. Replaced by more specialized
 * creeps when storage is built.
 *
 * Requirements:
 * - Process hauling tasks
 * - Move and pick up energy
 * - Move and drop off energy at spawn, extension
 * - If no drop offs with capacity, then build structures or upgrade controller
 *
 */
import {getBasePrimaryRoom, getCreepBase} from "./base";
import {behaviorBoosts} from "./behavior.boosts";
import {build, selectInfrastructureSites} from "./behavior.build";
import * as behaviorCommute from "./behavior.commute";
import * as behaviorHaul from "./behavior.haul";
import {roadWorker} from "./behavior.logistics";
import * as behaviorMovement from "./behavior.movement";
import {parkingLot} from "./behavior.room";
import {WORKER_DISTRIBUTOR} from "./constants.creeps";
import * as MEMORY from "./constants.memory";
import {Kernel} from "./kernel";
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS} from "./lib.behaviortree";
import {haulerPolicy} from "./role.hauler";

const selectDropoff = module.exports.selectRoomDropoff = behaviorTree.selectorNode(
  'selectRoomDropoff',
  [
    behaviorTree.leafNode(
      'use_memory_dropoff',
      (creep) => {
        const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        if (dropoff) {
          behaviorMovement.setDestination(creep, dropoff);
          return SUCCESS;
        }

        return FAILURE;
      },
    ),
    behaviorTree.leafNode(
      'pick_storage',
      (creep, trace, kernel: Kernel) => {
        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('could not find creep base', {name: creep.name, memory: creep.memory});
          // creep.suicide();
          return FAILURE;
        }

        const room = getBasePrimaryRoom(base)
        if (!room) {
          trace.error("could not find base primary room", {base})
          return FAILURE;
        }

        if (!room.storage) {
          return FAILURE;
        }

        if (!room.storage?.isActive()) {
          return FAILURE;
        }

        const distributors = _.filter(kernel.getCreepsManager().getCreepsByBase(base.id),
          (creep) => {
            return creep.memory[MEMORY.MEMORY_ROLE] === WORKER_DISTRIBUTOR;
          }
        );

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
      'pick_spawner_extension',
      (creep, trace, kernel) => {
        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('could not find creep base', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        const room = getBasePrimaryRoom(base);
        if (!room) {
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

const behavior = behaviorTree.sequenceNode(
  'haul_energy',
  [
    behaviorHaul.clearTask,
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorHaul.getHaulTaskFromBaseTopic,
        parkingLot,
      ],
    ),
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, haulerPolicy),
    behaviorHaul.loadCreep,
    behaviorHaul.clearTask,
    behaviorTree.selectorNode(
      'dump_or_build_or_upgrade',
      [
        behaviorTree.repeatUntilFailure(
          'dump_until_no_dropoff',
          behaviorTree.sequenceNode(
            'dump_energy',
            [
              behaviorTree.leafNode(
                'fail_when_empty',
                (creep, trace, kernel) => {
                  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    return SUCCESS;
                  }

                  return FAILURE;
                }
              ),
              selectDropoff,
              behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, haulerPolicy),
              behaviorHaul.emptyToDestination,
            ],
          ),
        ),
        behaviorTree.leafNode(
          'succeed_when_empty',
          (creep, trace, kernel) => {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
              return SUCCESS;
            }

            return FAILURE;
          }
        ),
        behaviorTree.sequenceNode(
          'build_construction_site',
          [
            selectInfrastructureSites,
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, haulerPolicy),
            build,
          ],
        ),
        behaviorTree.leafNode(
          'succeed_when_empty',
          (creep, trace, kernel) => {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
              return SUCCESS;
            }

            return FAILURE;
          }
        ),
        behaviorTree.sequenceNode(
          'upgrade_controller',
          [
            behaviorTree.leafNode(
              'pick_room_controller',
              (creep, trace, kernel) => {
                const base = getCreepBase(kernel, creep);
                if (!base) {
                  return FAILURE;
                }

                const room = Game.rooms[base.primary];
                if (!room) {
                  return FAILURE;
                }

                if (!room.controller) {
                  return FAILURE;
                }

                behaviorMovement.setDestination(creep, room.controller.id);
                return behaviorTree.SUCCESS;
              },
            ),
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, haulerPolicy),
            behaviorCommute.setCommuteDuration,
            behaviorTree.repeatUntilSuccess(
              'upgrade_until_empty',
              behaviorTree.leafNode(
                'upgrade_controller',
                (creep, trace, kernel) => {
                  const result = creep.upgradeController(creep.room.controller);
                  trace.log("upgrade result", {result})

                  if (result == ERR_NOT_ENOUGH_RESOURCES) {
                    return behaviorTree.SUCCESS;
                  }

                  if (result != OK) {
                    return behaviorTree.SUCCESS;
                  }

                  return behaviorTree.RUNNING;
                },
              ),
            ),
          ],
        ),
      ],
    ),
  ],
);

export const roleWorker = {
  run: behaviorTree.rootNode('worker', behaviorBoosts(roadWorker(behavior))),
};
