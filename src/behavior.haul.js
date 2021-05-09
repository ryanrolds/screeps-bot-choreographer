const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');

module.exports.getHaulTaskFromTopic = function(topic) {
  return behaviorTree.leafNode(
    'pick_haul_task',
    (creep, trace, kingdom) => {
      // lookup colony from kingdom
      const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
      const colony = kingdom.getColonyById(colonyId);

      // get next haul task
      const task = colony.getNextRequest(topic);
      if (!task) {
        trace.log('no haul task');
        return FAILURE;
      }

      this.storeHaulTask(creep, task, trace);

      return SUCCESS;
    },
  );
};

module.exports.getNearbyHaulTaskFromTopic = function(topic) {
  return behaviorTree.leafNode(
    'pick_nearby_haul_task',
    (creep, trace, kingdom) => {
      // lookup colony from kingdom
      const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
      const colony = kingdom.getColonyById(colonyId);

      // get next haul task
      const task = colony.getTopics().getMessageOfMyChoice(topic, (messages) => {
        let selected = null;
        let selectedDistance = 99999;

        messages.forEach((message) => {
          const pickupId = message.details[MEMORY.MEMORY_HAUL_PICKUP];
          if (pickupId) {
            return;
          }

          const pickup = Game.getObjectById(pickId);
          if (!pickup) {
            return;
          }

          if (pickup.room.name !== creep.room.name) {
            return;
          }

          const distance = creep.pos.getRangeTo(pickup);
          if (distance < selectedDistance) {
            selected = message;
            selectedDistance = distance;
          }
        });

        return selected;
      });
      if (!task) {
        return FAILURE;
      }

      this.storeHaulTask(creep, task, trace);

      return SUCCESS;
    },
  );
};

module.exports.storeHaulTask = (creep, task, trace) => {
  trace.log('store haul task', {task});

  // set task details
  creep.memory[MEMORY.TASK_ID] = task.details[MEMORY.TASK_ID];
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

  // const taskId = creep.memory[MEMORY.TASK_ID] || '?';
  // creep.say(taskId);
};

module.exports.clearTask = behaviorTree.leafNode(
  'clear_haul_task',
  (creep, trace, kingdom) => {
    delete creep.memory[MEMORY.MEMORY_TASK_TYPE];
    delete creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
    delete creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
    delete creep.memory[MEMORY.MEMORY_HAUL_AMOUNT];
    delete creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
    delete creep.memory[MEMORY.MEMORY_DESTINATION];

    return SUCCESS;
  },
);

module.exports.loadCreep = behaviorTree.leafNode(
  'load_resource',
  (creep, trace, kingdom) => {
    if (creep.store.getFreeCapacity() === 0) {
      return SUCCESS;
    }

    const pickup = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_PICKUP]);
    if (!pickup) {
      return SUCCESS;
    }

    let result = null;
    if (pickup instanceof Resource) {
      result = creep.pickup(pickup);
    } else {
      const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] || undefined;
      let amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] || undefined;

      if (amount > creep.store.getFreeCapacity(resource)) {
        amount = creep.store.getFreeCapacity(resource);
      }

      if (amount > pickup.store.getUsedCapacity(resource)) {
        amount = pickup.store.getUsedCapacity(resource);
      }

      // If we are seeing a specific amount, we are done when we have that amount in the hold
      if (creep.store.getUsedCapacity(resource) >= amount) {
        return SUCCESS;
      }

      if (amount === 0) {
        return FAILURE;
      }

      result = creep.withdraw(pickup, resource, amount);

      trace.log('load resource', {
        pickup: pickup.id,
        resource,
        amount,
        result,
      });
    }

    if (result === ERR_INVALID_ARGS) {
      return FAILURE;
    }

    if (result === ERR_FULL) {
      return SUCCESS;
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return SUCCESS;
    }

    if (result !== OK) {
      return FAILURE;
    }

    return RUNNING;
  },
);
