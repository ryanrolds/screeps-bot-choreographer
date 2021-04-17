
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorHaul = require('./behavior.haul');
const behaviorRoom = require('./behavior.room');
const behaviorBoosts = require('./behavior.boosts');
const featureFlags = require('./lib.feature_flags');

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
        trace.log('done_if_full_or_no_tasks', {
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
          behaviorTree.featureFlagBool(
            'flag_move_by_path',
            featureFlags.USE_HEAP_PATH_CACHE,
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, false, 50, 1500),
            behaviorMovement.moveByHeapPath(MEMORY.MEMORY_HAUL_PICKUP, 1, false, 50, 1500),
          ),
          behaviorHaul.loadCreep,
          behaviorHaul.clearTask,
          behaviorTree.returnSuccess(
            'get_nearby_all_task_return_success',
            behaviorHaul.getNearbyHaulTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
          ),
        ],
      ),
    ),
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
          behaviorTree.featureFlagBool(
            'flag_move_by_path',
            featureFlags.USE_HEAP_PATH_CACHE,
            behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_DROPOFF, 1, false, 50, 1500),
            behaviorMovement.moveByHeapPath(MEMORY.MEMORY_HAUL_DROPOFF, 1, false, 50, 1500),
          ),
          behaviorTree.leafNode(
            'empty_creep',
            (creep, trace, kingdom) => {
              if (creep.store.getUsedCapacity() === 0) {
                return SUCCESS;
              }

              const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]);
              if (!destination) {
                trace.log('no dump destination');
                return FAILURE;
              }

              const resource = Object.keys(creep.store).pop();

              const result = creep.transfer(destination, resource);

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

module.exports = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(behaviorNonCombatant(behavior))),
};
