
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorStorage = require('./behavior.storage');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorHaul = require('./behavior.haul');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');

const behavior = behaviorTree.sequenceNode(
  'haul_task',
  [
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorHaul.getTaskFromTopic(TOPICS.TOPIC_HAUL_TASK),
        behaviorTree.leafNode(
          'parking_lot',
          (creep, trace, kingdom) => {
            const room = kingdom.getCreepRoom(creep);
            if (!room) {
              return FAILURE;
            }

            const parkingLot = room.getParkingLot();
            if (!parkingLot) {
              return FAILURE;
            }

            creep.moveTo(parkingLot);

            return FAILURE;
          },
        ),
      ],
    ),
    behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_PICKUP),
    behaviorHaul.loadCreep,
    behaviorStorage.emptyCreep,
  ],
);

module.exports = {
  run: behaviorTree.rootNode('hauler', behaviorNonCombatant(behavior)),
};
