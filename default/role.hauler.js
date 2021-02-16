
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorStorage = require('./behavior.storage');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorHaul = require('./behavior.haul');
const behaviorRoom = require('./behavior.room');
const behaviorBoosts = require('./behavior.boosts');

const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');

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
    behaviorTree.repeatUntilConditionMet(
      'pickup_loads_until_full_or_no_tasks',
      (creep, trace, kingdom) => {
        trace.log(creep.id, 'done_if_full_or_no_tasks', {
          free: creep.store.getFreeCapacity(),
          taskType: creep.memory[MEMORY.MEMORY_TASK_TYPE],
        });

        if (!creep.memory[MEMORY.MEMORY_TASK_TYPE]) {
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
          behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_PICKUP, 1, false, 50, 1500),
          behaviorHaul.loadCreep,
          behaviorHaul.clearTask,
          behaviorTree.returnSuccess(
            'get_nearby_all_task_return_success',
            behaviorHaul.getNearbyHaulTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
          ),
        ],
      ),
    ),
    behaviorStorage.emptyCreep,
  ],
);

module.exports = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(behaviorNonCombatant(behavior))),
};
