const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorHaul = require('./behavior.haul');
const behaviorRoom = require('./behavior.room');
const behaviorBoosts = require('./behavior.boosts');

const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');

const selectNextTaskOrPark = behaviorTree.selectorNode(
  'pick_something',
  [
    behaviorTree.leafNode(
      'pick_haul_task',
      (creep, trace, kingdom) => {
        // lookup colony from kingdom
        const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
        const colony = kingdom.getColonyById(colonyId);

        // get next haul task
        const task = colony.getMessageOfMyChoice(TOPICS.HAUL_CORE_TASK, (messages) => {
          const sorted = _.sortByOrder(messages, [
            'priority',
            (message) => {
              const dropoff = Game.getObjectById(message.details[MEMORY.MEMORY_HAUL_DROPOFF]);
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

    const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
    if (!destination) {
      throw new Error('Missing unload destination');
    }

    const desiredResource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
    if (!desiredResource) {
      throw new Error('Hauler task missing desired resource');
    }

    const toUnload = _.difference(Object.keys(creep.store), [desiredResource]);
    if (!toUnload.length) {
      return SUCCESS;
    }

    const resource = toUnload.pop();

    const result = creep.transfer(destination, resource);

    trace.log('unload unneeded', {
      destination,
      resource,
      result,
    });

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

    return RUNNING;
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

        const loadedResources = Object.keys(creep.store);
        const toUnload = _.difference(loadedResources, [desiredResource]);
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
        behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_DESTINATION, 1, false, 10, 250),
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
        behaviorMovement.moveToCreepMemory(MEMORY.MEMORY_HAUL_PICKUP, 1, false, 10, 250),
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
      (creep, trace, kingdom) => {
        const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        if (dropoff) {
          behaviorMovement.setDestination(creep, dropoff);
          return SUCCESS;
        }

        return FAILURE;
      },
    ),
    behaviorMovement.moveToDestination(1, false, 10, 250),
    behaviorTree.leafNode(
      'empty_creep',
      (creep, trace, kingdom) => {
        if (creep.store.getUsedCapacity() === 0) {
          return SUCCESS;
        }

        const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
        if (!destination) {
          return FAILURE;
        }

        const resource = Object.keys(creep.store).pop();

        const result = creep.transfer(destination, resource);
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

module.exports = {
  run: behaviorTree.rootNode('distributor', behaviorBoosts(behavior)),
};
