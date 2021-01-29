const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorStorage = require('./behavior.storage');
const behaviorNonCombatant = require('./behavior.noncombatant');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');

const pathCache = require('./lib.path_cache')

module.exports.getTaskFromTopic = function(topic) {
  return behaviorTree.leafNode(
    'pick_haul_task',
    (creep, trace, kingdom) => {
      // lookup colony from kingdom
      const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
      const colony = kingdom.getColonyById(colonyId);

      delete creep.memory[MEMORY.MEMORY_TASK_TYPE]
      delete creep.memory[MEMORY.MEMORY_HAUL_PICKUP]
      delete creep.memory[MEMORY.MEMORY_HAUL_RESOURCE]
      delete creep.memory[MEMORY.MEMORY_HAUL_AMOUNT]
      delete creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]
      delete creep.memory[MEMORY.MEMORY_DESTINATION]

      // get next haul task
      const task = colony.getNextRequest(topic);
      if (!task) {
        return FAILURE;
      }

      // set task details
      creep.memory[MEMORY.MEMORY_TASK_TYPE] = TASKS.TASK_HAUL;
      creep.memory[MEMORY.MEMORY_HAUL_PICKUP] = task.details[MEMORY.MEMORY_HAUL_PICKUP];
      creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] = task.details[MEMORY.MEMORY_HAUL_RESOURCE];

      if (task.details[MEMORY.MEMORY_HAUL_AMOUNT]) {
        creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] = task.details[MEMORY.MEMORY_HAUL_AMOUNT];
      } else {
        // Clear this, "needs energy" task was limiting regular haul tasks
        delete creep.memory[MEMORY.MEMORY_HAUL_AMOUNT];
      }

      creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] = task.details[MEMORY.MEMORY_HAUL_DROPOFF];

      return SUCCESS;
    },
  )
}

module.exports.loadCreep = behaviorTree.leafNode(
  'load_resource',
  (creep, trace, kingdom) => {
    if (creep.store.getFreeCapacity() === 0) {
      return SUCCESS;
    }

    const pickup = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_PICKUP]);
    if (!pickup) {
      return FAILURE;
    }

    let result = null
    if (pickup instanceof Resource) {
      result = creep.pickup(pickup)
    } else {
      const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] || undefined
      let amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] || undefined;

      if (amount > creep.store.getFreeCapacity(resource)) {
        amount = creep.store.getFreeCapacity(resource)
      }

      if (amount > pickup.store.getUsedCapacity(resource)) {
        amount = pickup.store.getUsedCapacity(resource)
      }

      if (amount === 0) {
        return FAILURE;
      }

      // If we are seeing a specific amount, we are done when we have that amount in the hold
      if (amount && creep.store.getUsedCapacity(resource) >= amount) {
        return SUCCESS;
      }

      result = creep.withdraw(pickup, resource, amount);
    }

    if (result === ERR_INVALID_ARGS) {
      return FAILURE;
    }

    if (result === ERR_FULL) {
      return SUCCESS;
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return FAILURE;
    }

    if (result !== OK) {
      return FAILURE;
    }

    return RUNNING;
  },
);
