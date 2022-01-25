
import {behaviorBoosts} from "./behavior.boosts";
// import behaviorBuild from "./behavior.build";
import * as behaviorHaul from "./behavior.haul";
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
        behaviorRoom.parkingLot,
      ],
    ),
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, commonPolicy),
    behaviorHaul.loadCreep,
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

        const resources = Object.keys(creep.store);
        const resource = resources.pop();
        const result = creep.transfer(destination, resource as ResourceConstant);

        if (result !== OK) {
          trace.error('transfer error', {result, resource, resources});
          return FAILURE;
        }

        trace.log('transfer result', {result, resource, resources});

        // We have more resources to unload
        if (resources.length > 0) {
          return RUNNING;
        }

        return SUCCESS;
      },
    ),
  ],
);

export const roleHauler = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
