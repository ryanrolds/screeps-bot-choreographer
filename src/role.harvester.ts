import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";
import behaviorCommute from "./behavior.commute";
import behaviorStorage from "./behavior.storage";
import * as behaviorMovement from "./behavior.movement";
import {build, selectSite} from "./behavior.build";
import * as behaviorHarvest from "./behavior.harvest";
import {behaviorBoosts} from "./behavior.boosts";
import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./lib.pathing_policies";
import {roadWorker} from "./behavior.logistics";

const behavior = behaviorTree.sequenceNode(
  'haul_energy',
  [
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_SOURCE_POSITION, 1, commonPolicy),
    behaviorCommute.setCommuteDuration,
    behaviorHarvest.harvest,
    behaviorTree.selectorNode(
      'dump_or_build_or_upgrade',
      [
        behaviorTree.sequenceNode(
          'dump_energy',
          [
            behaviorStorage.selectRoomDropoff,
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, commonPolicy),
            behaviorTree.leafNode(
              'empty_creep',
              (creep, trace, kingdom) => {
                const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
                if (!destination) {
                  trace.log('no destination', {destination: creep.memory[MEMORY.MEMORY_DESTINATION]});
                  return FAILURE;
                }

                const resource = Object.keys(creep.store).pop();
                const result = creep.transfer(destination, resource as ResourceConstant);
                trace.log('transfer', {result, resource});

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
            ),
          ],
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

export const roleHarvester = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
