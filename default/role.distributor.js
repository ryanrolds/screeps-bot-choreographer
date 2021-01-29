
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorStorage = require('./behavior.storage');
const behaviorHaul = require('./behavior.haul');

const MEMORY = require('./constants.memory')
const TOPICS = require('./constants.topics')
const TASKS = require('./constants.tasks')

const {MEMORY_DESTINATION} = require('./constants.memory');

// The goal is to not tell two  Distributors to go to the same structure needing
// energy. So, we lookup all the currently assigned destinations and subtract those
// from the list of structures needing energy. Then we find the closest structure
// needing energy
const selectDropoff = behaviorTree.leafNode(
  'select_distributor_transfer',
  (creep, trace, kingdom) => {
    const room = kingdom.getCreepRoom(creep);
    if (!room) {
      return FAILURE;
    }

    const structure = room.getNextEnergyStructure(creep);
    if (!structure) {
      return RUNNING;
    }

    creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] = structure.id
    return SUCCESS;
  },
);

const behavior = behaviorTree.selectorNode(
  'core_task_or_extensions',
  [
    /*
    behaviorTree.sequenceNode(
      'haul_core_task',
      [
        behaviorHaul.getTaskFromTopic(TOPICS.HAUL_CORE_TASK),
        behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_PICKUP),
        behaviorHaul.loadCreep,
        behaviorStorage.emptyCreep,
      ]
    ),
    */
    behaviorTree.sequenceNode(
      'dump_energy',
      [
        selectDropoff,
        behaviorTree.selectorNode(
          'fill_distributor',
          [
            behaviorTree.leafNode(
              'fill_if_empty',
              (creep, trace, kingdom) => {
                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) !== 0) {
                  return SUCCESS
                }

                return FAILURE;
              }
            ),
            behaviorStorage.fillCreep
          ]
        ),
        behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_DROPOFF, 1),
        behaviorTree.leafNode(
          'empty_creep',
          (creep, trace, kingdom) => {
            const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]);
            if (!destination) {
              return FAILURE;
            }

            const result = creep.transfer(destination, RESOURCE_ENERGY);
            if (result === ERR_FULL) {
              return SUCCESS;
            }
            if (result === ERR_NOT_ENOUGH_RESOURCES) {
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
  ]
);


module.exports = {
  run: behaviorTree.rootNode('distributor', behavior)
};
