import {getCreepBase, getStructureForResource} from './base';
import {behaviorBoosts} from './behavior.boosts';
import * as behaviorHaul from './behavior.haul';
import {roadWorker} from './behavior.logistics';
import * as behaviorMovement from './behavior.movement';
import {parkingLot} from './behavior.room';
import * as MEMORY from './constants.memory';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';
import {TopicKey} from './lib.topics';

export function getBaseDistributorTopic(baseId: string): TopicKey {
  return `base_${baseId}_distributor`;
}

const selectNextTaskOrPark = behaviorTree.selectorNode(
  'pick_something',
  [
    behaviorTree.leafNode(
      'pick_haul_task',
      (creep, trace, kernel) => {
        // lookup base from kernel
        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('could not find creep base', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return;
        }

        // get next haul task
        const task = kernel.getTopics().getMessageOfMyChoice(getBaseDistributorTopic(base.id), (messages) => {
          const sorted = _.sortByOrder(messages, [
            'priority',
            (message: any) => {
              const dropoff = Game.getObjectById<Id<Structure<StructureConstant>>>(message.details[MEMORY.MEMORY_HAUL_DROPOFF]);
              if (!dropoff) {
                return -1;
              }

              return creep.pos.getRangeTo(dropoff);
            },
          ], ['desc', 'asc']);

          trace.info('sorted core haul tasks', {sorted});

          if (sorted.length) {
            return sorted[0];
          }

          return null;
        });

        if (!task) {
          trace.info('no haul task');
          return FAILURE;
        }

        behaviorHaul.storeHaulTask(creep, task, trace);

        return SUCCESS;
      },
    ),
    parkingLot,
  ],
);

const emptyCreep = behaviorTree.leafNode(
  'empty_creep',
  (creep, trace, kernel) => {
    if (creep.store.getUsedCapacity() === 0) {
      return SUCCESS;
    }

    const destinationId = creep.memory[MEMORY.MEMORY_DESTINATION];
    const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(destinationId);
    if (!destination) {
      trace.error('could not find destination', {destinationId});
      return FAILURE;
    }

    const desiredResource: ResourceConstant = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
    if (!desiredResource) {
      trace.error('no desired resource', {creep});
      return FAILURE;
    }

    const taskId = creep.memory[MEMORY.TASK_ID];

    let resources = Object.keys(creep.store);
    if (!taskId.startsWith('lu-')) {
      // If not a link unload, we should unload what isnt needed
      resources = _.difference(resources, [desiredResource]);
    }

    if (!resources.length) {
      return SUCCESS;
    }

    const resource = resources.pop();
    const result = creep.transfer(destination, resource as ResourceConstant);

    if (result !== OK) {
      trace.error('transfer error', {result, resource, resources});
      return FAILURE;
    }

    trace.info('transfer result', {result, resource, resources});

    // We have more resources to unload
    if (resources.length > 0) {
      return RUNNING;
    }

    return SUCCESS;
  },
);

const unloadIfNeeded = behaviorTree.selectorNode(
  'unload_creep_if_needed',
  [
    behaviorTree.leafNode(
      'check_if_unload_needed',
      (creep, trace, kernel) => {
        const desiredResource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        if (!desiredResource) {
          throw new Error('Hauler task missing desired resource');
        }

        const taskId = creep.memory[MEMORY.TASK_ID];
        const loadedResources = Object.keys(creep.store) as ResourceConstant[];

        let toUnload = loadedResources;
        if (!taskId.startsWith('lu-')) {
          // If not a link unload, we should unload what isnt needed
          toUnload = _.difference(loadedResources, [desiredResource]);
        }

        trace.info('to unload', {loadedResources, desiredResource, toUnload});

        if (toUnload.length) {
          const base = getCreepBase(kernel, creep);
          if (!base) {
            throw new Error('Unable to get room for creep');
          }

          const reserve = getStructureForResource(base, toUnload[0]);
          creep.memory[MEMORY.MEMORY_DESTINATION] = reserve.id;

          trace.info('unloading at', {
            loaded: JSON.stringify(loadedResources),
            toUnload: JSON.stringify(toUnload),
            desired: JSON.stringify([desiredResource]),
            dropoff: reserve.id,
          });

          return FAILURE;
        }

        return SUCCESS;
      },
    ),
    behaviorTree.sequenceNode(
      'move_and_unload',
      [
        behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_DESTINATION, 1, false, 25, 500),
        emptyCreep,
      ],
    ),
  ],
);

const loadIfNeeded = behaviorTree.selectorNode(
  'load_creep_if_needed',
  [
    behaviorTree.leafNode(
      'has_resource',
      (creep, trace, kernel) => {
        const dropoffId = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        if (!dropoffId) {
          throw new Error('Hauler task missing dropoff');
        }

        const dropoff = Game.getObjectById(dropoffId);
        if (!dropoff) {
          trace.error('no dropoff', {dropoffId});
          return FAILURE;
        }

        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        if (!resource) {
          trace.error('no resource', {creep});
          return FAILURE;
        }

        let amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT];
        if (!amount) {
          const taskId = creep.memory[MEMORY.TASK_ID] || 'unknown task id';
          throw new Error(`Hauler task missing amount: ${taskId}`);
        }

        if (creep.store.getUsedCapacity(resource) > amount * 0.5) {
          return SUCCESS;
        }

        if (amount >= creep.store.getCapacity(resource)) {
          amount = creep.store.getCapacity(resource);
          creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] = amount;
        }

        if (amount < creep.store.getCapacity(resource) && resource === RESOURCE_ENERGY) {
          creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] = creep.store.getCapacity(resource);
        }

        trace.info('has resource', {
          resource,
          amount,
          creepAmount: creep.store.getUsedCapacity(resource),
        });

        if (creep.store.getUsedCapacity(resource) >= amount) {
          return SUCCESS;
        }

        if (dropoff instanceof StructureExtension) {
          // Update amount to be a full creep so that we can fill multiple extensions
          creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] = creep.store.getCapacity(RESOURCE_ENERGY);
        }

        return FAILURE;
      },
    ),
    behaviorTree.sequenceNode(
      'get_resource',
      [
        behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_PICKUP, 1, false, 25, 1000),
        behaviorHaul.loadCreep,
      ],
    ),
  ],
);

const deliver = behaviorTree.sequenceNode(
  'deliver',
  [
    behaviorTree.leafNode(
      'use_memory_dropoff',
      (creep, trace, kernel) => {
        const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        if (dropoff) {
          behaviorMovement.setDestination(creep, dropoff);
          return SUCCESS;
        }

        return FAILURE;
      },
    ),
    behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_DESTINATION, 1, false, 25, 250),
    behaviorTree.leafNode(
      'empty_creep',
      (creep, trace, kernel) => {
        if (creep.store.getUsedCapacity() === 0) {
          return SUCCESS;
        }

        const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
        if (!destination) {
          return FAILURE;
        }

        const resource = Object.keys(creep.store).pop();

        const result = creep.transfer(destination, resource as ResourceConstant);
        trace.info('transfer', {resource, result});

        if (result === ERR_FULL) {
          return SUCCESS;
        }

        if (result === ERR_NOT_ENOUGH_RESOURCES) {
          return SUCCESS;
        }

        if (result === ERR_INVALID_TARGET) {
          return SUCCESS;
        }

        if (result != OK) {
          return FAILURE;
        }

        return SUCCESS;
      },
    ),
  ],
);

const behavior = behaviorTree.sequenceNode(
  'core_task_or_extensions',
  [
    behaviorHaul.clearTask,
    selectNextTaskOrPark,
    unloadIfNeeded,
    loadIfNeeded,
    deliver,
  ],
);

export const roleDistributor = {
  run: behaviorTree.rootNode('distributor', behaviorBoosts(roadWorker(behavior))),
};
