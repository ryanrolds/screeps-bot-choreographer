
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";
import * as behaviorMovement from "./behavior.movement";
import behaviorNonCombatant from "./behavior.noncombatant";
import behaviorHaul from "./behavior.haul";
import behaviorRoom from "./behavior.room";
import behaviorBoosts from "./behavior.boosts";

import * as MEMORY from "./constants.memory";
import * as TOPICS from "./constants.topics";
import {RoomCallbackRules} from "./lib.path_cache";

const rules: RoomCallbackRules = {
  avoidOwnedRooms: true,
  avoidHostiles: true,
  avoidFriendlyRooms: false,
};

const emptyCreep = behaviorTree.repeatUntilConditionMet(
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
      behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_DROPOFF, 1, 2500, rules),
      behaviorTree.leafNode(
        'empty_creep',
        (creep, trace, kingdom) => {
          if (creep.store.getUsedCapacity() === 0) {
            return SUCCESS;
          }

          const destination: AnyStoreStructure = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]);
          if (!destination) {
            trace.log('no dump destination');
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
);

const behavior = behaviorTree.sequenceNode(
  'haul_task',
  [
    behaviorHaul.clearTask,
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorHaul.getHaulTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
        behaviorTree.tripIfCalledXTimes(
          'recycle_if_parked_too_long',
          200,
          behaviorRoom.parkingLot,
          behaviorTree.sequenceNode(
            'dump_and_recycle',
            [
              behaviorTree.leafNode('recycle_dump', (creep, trace, kingdom) => {
                const colony = kingdom.getCreepColony(creep);
                if (!colony) {
                  trace.log('could not find creep colony');
                  return FAILURE;
                }

                const resource = Object.keys(creep.store).pop();
                const dropoff = colony.getReserveStructureWithRoomForResource(resource);
                creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] = dropoff.id;
              }),
              emptyCreep,
              behaviorRoom.recycleCreep,
            ],
          ),
        ),
      ],
    ),
    behaviorTree.repeatUntilConditionMet(
      'pickup_loads_until_full_or_no_tasks',
      (creep, trace, kingdom) => {
        trace.log('done_if_full_or_no_tasks', {
          free: creep.store.getFreeCapacity(),
          taskType: creep.memory[MEMORY.MEMORY_TASK_TYPE] || null,
        });

        if (!creep.memory[MEMORY.MEMORY_TASK_TYPE]) {
          trace.log('done because no task type');
          return true;
        }

        if (creep.store.getFreeCapacity() === 0) {
          return true;
        }

        return false;
      },
      behaviorTree.sequenceNode(
        'pickup_load',
        [
          behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, 2500, rules),
          behaviorHaul.loadCreep,
          behaviorHaul.clearTask,
          behaviorTree.returnSuccess(
            'get_nearby_all_task_return_success',
            behaviorHaul.getNearbyHaulTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
          ),
        ],
      ),
    ),
    emptyCreep,
  ],
);

export const roleHauler = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(behaviorNonCombatant(behavior))),
};
