import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";
import behaviorCommute from "./behavior.commute";
import behaviorStorage from "./behavior.storage";
import * as behaviorMovement from "./behavior.movement";
import behaviorBuild from "./behavior.build";
import behaviorHarvest from "./behavior.harvest";
import {behaviorBoosts} from "./behavior.boosts";
import * as MEMORY from "./constants.memory";
import {PathFinderPolicy} from "./lib.path_cache";

const policy: PathFinderPolicy = {
  avoidFriendlyRooms: false,
  avoidHostiles: true,
  avoidOwnedRooms: true,
  maxOps: 1000,
}

const behavior = behaviorTree.sequenceNode(
  'haul_energy',
  [
    // behaviorHarvest.moveToHarvestRoom,
    // behaviorHarvest.moveToHarvest,
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_SOURCE_POSITION, 1, 2000, policy),
    behaviorCommute.setCommuteDuration,
    behaviorHarvest.harvest,
    behaviorTree.selectorNode(
      'dump_or_build',
      [
        behaviorTree.sequenceNode(
          'dump_energy',
          [
            behaviorStorage.selectRoomDropoff,
            behaviorMovement.moveToDestinationRoom,
            behaviorMovement.moveToDestination(1, true, 50, 2000),
            behaviorTree.leafNode(
              'empty_creep',
              (creep) => {
                const destination = Game.getObjectById<Id<(Creep | Structure<StructureConstant>)>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
                if (!destination) {
                  return FAILURE;
                }

                const resource = Object.keys(creep.store).pop();
                const result = creep.transfer(destination, resource as ResourceConstant);
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
          'build_construction_site',
          [
            behaviorBuild.selectSite,
            behaviorMovement.moveToDestinationRoom,
            behaviorMovement.moveToDestination(1, true, 50, 2000),
            behaviorBuild.build,
          ],
        ),
      ],
    ),
  ],
);

export const roleHarvester = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(behavior)),
};
