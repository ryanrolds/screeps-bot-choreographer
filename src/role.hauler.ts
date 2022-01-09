
import {behaviorBoosts} from "./behavior.boosts";
// import behaviorBuild from "./behavior.build";
import behaviorHaul from "./behavior.haul";
import {roadWorker} from "./behavior.logistics";
import * as behaviorMovement from "./behavior.movement";
import behaviorRoom from "./behavior.room";
import * as MEMORY from "./constants.memory";
import * as TOPICS from "./constants.topics";
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, RUNNING, SUCCESS} from "./lib.behaviortree";
import {commonPolicy} from "./lib.pathing_policies";

const behavior = behaviorTree.sequenceNode(
  'haul_task',
  [
    behaviorHaul.clearTask,
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorHaul.getHaulTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
        /* Remove if not used in a while - Jan 2022
        behaviorTree.sequenceNode(
          'build_construction_site',
          [
            behaviorTree.leafNode('has_energy',
              (creep, trace, kingdom) => {
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                  return FAILURE;
                }

                return SUCCESS;
              }
            ),
            behaviorBuild.selectSite,
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, commonPolicy),
            behaviorBuild.build,
          ],
        ),
        */
        behaviorRoom.parkingLot,
      ],
    ),
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, commonPolicy),
    behaviorHaul.loadCreep,
    behaviorTree.repeatUntilConditionMet(
      'transfer_until_empty',
      (creep, trace, kingdom) => {
        if (creep.store.getUsedCapacity() === 0) {
          return true;
        }

        return false;
      },
      behaviorTree.sequenceNode(
        'dump_energy',
        [
          behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_DROPOFF, 1, commonPolicy),
          behaviorTree.leafNode(
            'empty_creep',
            (creep, trace, kingdom) => {
              if (creep.store.getUsedCapacity() === 0) {
                return SUCCESS;
              }

              const destination = Game.getObjectById<Id<AnyStoreStructure>>(creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]);
              if (!destination) {
                trace.error('no dump destination');
                return FAILURE;
              }

              const resource = Object.keys(creep.store).pop();
              const result = creep.transfer(destination, resource as ResourceConstant);
              trace.log('transfer result', {result});

              if (result === ERR_FULL) {
                return FAILURE;
              }

              if (result === ERR_NOT_ENOUGH_RESOURCES) {
                return FAILURE;
              }

              if (result === ERR_INVALID_TARGET) {
                return FAILURE;
              }

              if (result != OK) {
                return FAILURE;
              }

              return RUNNING;
            },
          ),
        ],
      ),
    ),
  ],
);

export const roleHauler = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
