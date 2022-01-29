
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
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";
import * as behaviorCommute from "./behavior.commute";
import behaviorStorage from "./behavior.storage";
import * as behaviorMovement from "./behavior.movement";
import {build, selectInfrastructureSites} from "./behavior.build";
import * as behaviorHarvest from "./behavior.harvest";
import {behaviorBoosts} from "./behavior.boosts";
import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./lib.pathing_policies";
import {roadWorker} from "./behavior.logistics";
import * as behaviorHaul from "./behavior.haul";
import * as TOPICS from "./constants.topics";
import behaviorRoom from "./behavior.room";
import {WORKER_DISTRIBUTOR} from "./constants.creeps";

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
      (creep, trace, kingdom) => {
        const colony = kingdom.getCreepColony(creep);
        if (!colony) {
          trace.error('could not find creep colony', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        const room = colony.getPrimaryRoom();
        if (!room) {
          return FAILURE;
        }

        if (!room.hasStorage) {
          return FAILURE;
        }

        if (!room.room.storage?.isActive()) {
          return FAILURE;
        }

        const distributors = _.filter(room.getCreeps(), (creep) => {
          return creep.memory[MEMORY.MEMORY_ROLE] === WORKER_DISTRIBUTOR;
        });

        if (!distributors.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, room.room.storage.id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_tower',
      (creep, trace, kingdom) => {
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
      (creep, trace, kingdom) => {
        const colony = kingdom.getCreepColony(creep);
        if (!colony) {
          trace.error('could not find creep colony', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        if (!colony.primaryRoom) {
          return FAILURE;
        }

        const targets = colony.primaryRoom.find(FIND_STRUCTURES, {
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
        behaviorHaul.getHaulTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
        behaviorTree.leafNode(
          'top',
          (creep, trace, kingdom) => {
            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) !== 0) {
              creep.say('🚚⁉️');
              trace.notice('failed to get task', {name: creep.name});
            }
            return FAILURE;
          },
        ),
        behaviorRoom.parkingLot,
      ],
    ),
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, commonPolicy),
    behaviorHaul.loadCreep,
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
                (creep, trace, kingdom) => {
                  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
                    return SUCCESS;
                  }

                  return FAILURE;
                }
              ),
              selectDropoff,
              behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, commonPolicy),
              behaviorTree.leafNode(
                'empty_creep',
                (creep, trace, kingdom) => {
                  const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
                  if (!destination) {
                    trace.log('no destination', {destination: creep.memory[MEMORY.MEMORY_DESTINATION]});
                    return SUCCESS;
                  }

                  const resource = Object.keys(creep.store).pop();
                  const result = creep.transfer(destination, resource as ResourceConstant);
                  trace.log('transfer', {result, resource});

                  if (result === ERR_FULL) {
                    // We still have energy to transfer, fail so we find another
                    // place to dump
                    return SUCCESS;
                  }
                  if (result === ERR_NOT_ENOUGH_RESOURCES) {
                    return SUCCESS;
                  }
                  if (creep.store.getUsedCapacity() === 0) {
                    return SUCCESS;
                  }
                  if (result != OK) {
                    return SUCCESS;
                  }

                  return RUNNING;
                },
              ),
            ],
          ),
        ),
        behaviorTree.leafNode(
          'succeed_when_empty',
          (creep, trace, kingdom) => {
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
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, commonPolicy),
            build,
          ],
        ),
        behaviorTree.leafNode(
          'succeed_when_empty',
          (creep, trace, kingdom) => {
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
              (creep, trace, kingdom) => {
                const baseConfig = kingdom.getCreepBaseConfig(creep);
                if (!baseConfig) {
                  return FAILURE;
                }

                const room = Game.rooms[baseConfig.primary];
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
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, commonPolicy),
            behaviorCommute.setCommuteDuration,
            behaviorTree.repeatUntilSuccess(
              'upgrade_until_empty',
              behaviorTree.leafNode(
                'upgrade_controller',
                (creep, trace, kingdom) => {
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
