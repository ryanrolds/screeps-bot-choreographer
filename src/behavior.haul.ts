import {getCreepBase} from './base';
import * as MEMORY from './constants.memory';
import * as TASKS from './constants.tasks';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';
import {getBaseHaulerTopic} from './runnable.base_logistics';

export const getHaulTaskFromBaseTopic = behaviorTree.leafNode(
  'pick_haul_task',
  (creep, trace, kernel) => {
    // lookup base from kingdom
    const baseId = creep.memory[MEMORY.MEMORY_BASE];
    const base = kernel.getPlanner().getBaseById(baseId);
    if (!base) {
      trace.error('could not find base', {name: creep.name, memory: creep.memory});
      creep.suicide();
      return FAILURE;
    }

    // get next haul task
    const task = kernel.getTopics().getNextRequest(getBaseHaulerTopic(baseId));
    if (!task) {
      trace.info('no haul task');
      return FAILURE;
    }

    storeHaulTask(creep, task, trace);

    return SUCCESS;
  },
);

export const getNearbyHaulTaskFromTopic = function (topic) {
  return behaviorTree.leafNode(
    'pick_nearby_haul_task',
    (creep, trace, kernel) => {
      const base = getCreepBase(kernel, creep);
      if (!base) {
        trace.info('could not find base', {name: creep.name, memory: creep.memory});
        creep.suicide();
        return FAILURE;
      }

      // get next haul task
      const task = kernel.getTopics().getMessageOfMyChoice(topic, (messages) => {
        let selected = null;
        let selectedDistance = 99999;

        messages.forEach((message) => {
          const pickupId = message.details[MEMORY.MEMORY_HAUL_PICKUP];
          if (!pickupId) {
            trace.info('no pickup id', {message});
            return;
          }

          const pickup = Game.getObjectById<Id<Structure>>(pickupId);
          if (!pickup) {
            trace.info('could not find object to pickup', {pickupId});
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

      storeHaulTask(creep, task, trace);

      return SUCCESS;
    },
  );
};

export const storeHaulTask = (creep, task, trace) => {
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

export const clearTask = behaviorTree.leafNode(
  'clear_haul_task',
  (creep, _trace, _kingdom) => {
    delete creep.memory[MEMORY.TASK_ID];
    delete creep.memory[MEMORY.MEMORY_TASK_TYPE];
    delete creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
    delete creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
    delete creep.memory[MEMORY.MEMORY_HAUL_AMOUNT];
    delete creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
    delete creep.memory[MEMORY.MEMORY_DESTINATION];

    return SUCCESS;
  },
);

export const loadCreep = behaviorTree.leafNode(
  'load_resource',
  (creep, trace, _kingdom) => {
    if (creep.store.getFreeCapacity() === 0) {
      trace.info('creep is full');
      return SUCCESS;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickup: any = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_PICKUP]);
    if (!pickup) {
      creep.say('⬆️❌');
      trace.error('could not find pickup', {id: creep.memory[MEMORY.MEMORY_HAUL_PICKUP]});
      return FAILURE;
    }

    const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] || undefined;
    let amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] || undefined;

    let result = null;
    if (pickup instanceof Resource) {
      result = creep.pickup(pickup);
      trace.info('pickup resource', {
        pickup: pickup.id,
      });
    } else {
      const structure: AnyStoreStructure = pickup;

      if (amount > creep.store.getFreeCapacity(resource)) {
        amount = creep.store.getFreeCapacity(resource);
      }

      if (amount > structure.store.getUsedCapacity(resource)) {
        amount = structure.store.getUsedCapacity(resource);
      }

      // If we are seeing a specific amount, we are done when we have that amount in the hold
      if (creep.store.getUsedCapacity(resource) >= amount) {
        return SUCCESS;
      }

      if (amount === 0) {
        trace.error('zero amount', {resource, amount, creep, pickup});
        return FAILURE;
      }

      result = creep.withdraw(structure, resource, amount);

      trace.info('withdraw resource', {
        structure: structure.id,
        resource,
        amount,
        result,
      });
    }

    if (result === ERR_INVALID_ARGS) {
      trace.error('invalid args', {resource, amount, pickup});
      return FAILURE;
    }

    if (result === ERR_FULL) {
      trace.notice('full', {resource, amount, pickup});
      return SUCCESS;
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      trace.notice('not enough resources', {resource, amount, pickup});
      return SUCCESS;
    }

    if (result !== OK) {
      trace.error('could not load resource', {result, resource, amount, pickup});
      return FAILURE;
    }

    // If we do not wait until next tick, the creep will not
    // know it's full
    return RUNNING;
  },
);

// TODO marge these to into a generic one that takes a memory key to an object id
export const emptyCreep = behaviorTree.leafNode(
  'empty_creep',
  (creep, trace, _kingdom) => {
    const destination = Game.getObjectById<Id<AnyStoreStructure>>(creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]);
    if (!destination) {
      creep.say('⬇️❌');
      trace.error('no dump destination', {name: creep.name, memory: creep.memory});
      return FAILURE;
    }

    const resources = Object.keys(creep.store);
    const resource = resources.pop();
    const result = creep.transfer(destination, resource as ResourceConstant);

    trace.info('transfer result', {result, resource, resources});

    if (result === ERR_FULL) {
      trace.warn('transfer error: full', {result, resource, resources});
      const dropResult = creep.drop(resource as ResourceConstant);
      trace.info('drop result', {result: dropResult, resource, resources});
    } else if (result !== OK) {
      trace.error('transfer error', {result, resource, resources});
      return FAILURE;
    }

    // We have more resources to unload
    if (resources.length > 0) {
      trace.info('more do dump', {resources});
      return RUNNING;
    }

    return SUCCESS;
  },
);

export const emptyToDestination = behaviorTree.leafNode(
  'empty_creep_to_destination',
  (creep, trace, _kingdom) => {
    const destinationId = creep.memory[MEMORY.MEMORY_DESTINATION];
    const destination = Game.getObjectById<Id<AnyStoreStructure>>(destinationId);
    if (!destination) {
      creep.say('⬇️❌');
      trace.error('no dump destination', {name: creep.name, memory: creep.memory});
      return FAILURE;
    }

    const resources = Object.keys(creep.store);
    const resource = resources.pop();
    const result = creep.transfer(destination, resource as ResourceConstant);

    trace.info('transfer result', {result, resource, resources});

    if (result === ERR_FULL) {
      trace.info('transfer error: full', {result, resource, resources});
    } else if (result !== OK) {
      trace.error('transfer error', {result, resource, resources});
      return FAILURE;
    }

    // We have more resources to unload
    if (resources.length > 0) {
      trace.info('more do dump', {resources});
      return RUNNING;
    }

    return SUCCESS;
  },
);
