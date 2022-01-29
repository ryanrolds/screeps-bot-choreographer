import * as behaviorTree from './lib.behaviortree';
import {FAILURE, SUCCESS, RUNNING} from './lib.behaviortree';
import * as behaviorMovement from './behavior.movement';
import * as behaviorHaul from './behavior.haul';
import * as behaviorRoom from './behavior.room';
import {behaviorBoosts} from './behavior.boosts';

import * as MEMORY from './constants.memory';
import * as TOPICS from './constants.topics';
import {roadWorker} from './behavior.logistics';
import {AllowedCostMatrixTypes} from './lib.costmatrix_cache';
import {FindPathPolicy} from './lib.pathing';

export const distributorPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.COMMON,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 5,
    maxOps: 1000,
    maxPathRooms: 2,
    ignoreCreeps: true,
  },
};

const selectNextTaskOrPark = behaviorTree.selectorNode(
  'pick_something',
  [
    behaviorTree.leafNode(
      'pick_haul_task',
      (creep, trace, kingdom) => {
        // lookup colony from kingdom
        const colonyId = creep.memory[MEMORY.MEMORY_BASE];
        const colony = kingdom.getColonyById(colonyId);

        if (!colony) {
          trace.log('could not find colony', {name: creep.name, memory: creep.memory});
          creep.suicide();
          return FAILURE;
        }

        // get next haul task
        const task = colony.getMessageOfMyChoice(TOPICS.HAUL_CORE_TASK, (messages) => {
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

          trace.log('sorted core haul tasks', {sorted});

          if (sorted.length) {
            return sorted[0];
          }

          return null;
        });
        if (!task) {
          trace.log('no haul task');
          return FAILURE;
        }

        behaviorHaul.storeHaulTask(creep, task, trace);

        return SUCCESS;
      },
    ),
    behaviorRoom.parkingLot,
  ],
);

const emptyCreep = behaviorTree.leafNode(
  'empty_creep',
  (creep, trace, kingdom) => {
    if (creep.store.getUsedCapacity() === 0) {
      return SUCCESS;
    }

    const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
    if (!destination) {
      throw new Error('Missing unload destination');
    }

    const desiredResource: ResourceConstant = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
    if (!desiredResource) {
      throw new Error('Hauler task missing desired resource');
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

    trace.log('transfer result', {result, resource, resources});

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
      (creep, trace, kingdom) => {
        const desiredResource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        if (!desiredResource) {
          throw new Error('Hauler task missing desired resource');
        }

        const taskId = creep.memory[MEMORY.TASK_ID];
        const loadedResources = Object.keys(creep.store);

        let toUnload = loadedResources;
        if (!taskId.startsWith('lu-')) {
          // If not a link unload, we should unload what isnt needed
          toUnload = _.difference(loadedResources, [desiredResource]);
        }

        trace.log('to unload', {loadedResources, desiredResource, toUnload});

        if (toUnload.length) {
          const room = kingdom.getCreepRoom(creep);
          if (!room) {
            throw new Error('Unable to get room for creep');
          }

          const reserve = room.getReserveStructureWithRoomForResource(toUnload[0]);
          creep.memory[MEMORY.MEMORY_DESTINATION] = reserve.id;

          trace.log('unloading at', {
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
        behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, distributorPolicy),
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
      (creep, trace, kingdom) => {
        const dropoffId = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        if (!dropoffId) {
          throw new Error('Hauler task missing dropoff');
        }

        const dropoff = Game.getObjectById(dropoffId);
        if (!dropoff) {
          throw new Error('Hauler task has invalid dropoff');
        }

        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        if (!resource) {
          throw new Error('Hauler task missing resource');
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

        trace.log('has resource', {
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
        behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, distributorPolicy),
        behaviorHaul.loadCreep,
      ],
    ),
  ],
);

const deliver = behaviorTree.sequenceNode(
  'deliver',
  [
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_DROPOFF, 1, distributorPolicy),
    behaviorTree.leafNode(
      'empty_creep',
      (creep, trace, kingdom) => {
        if (creep.store.getUsedCapacity() === 0) {
          return SUCCESS;
        }

        const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
        if (!destination) {
          return FAILURE;
        }

        const resource = Object.keys(creep.store).pop();

        const result = creep.transfer(destination, resource as ResourceConstant);
        trace.log('transfer', {resource, result});

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
}
