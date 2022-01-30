
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
    behaviorHaul.emptyCreep,
  ],
);

export const roleHauler = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
