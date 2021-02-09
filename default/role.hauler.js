
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorStorage = require('./behavior.storage');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorHaul = require('./behavior.haul');
const behaviorRoom = require('./behavior.room');

const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');

const behavior = behaviorTree.sequenceNode(
  'haul_task',
  [
    behaviorHaul.clearTask,
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorHaul.getTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
        behaviorRoom.parkingLot,
      ],
    ),
    behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_PICKUP, 1, false),
    behaviorHaul.loadCreep,
    behaviorStorage.emptyCreep,
  ],
);

module.exports = {
  run: behaviorTree.rootNode('hauler', behaviorNonCombatant(behavior)),
};
