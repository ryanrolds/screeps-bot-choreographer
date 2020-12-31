
const behaviorTree = require('lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree');
const behaviorMovement = require('behavior.movement');
const behaviorStorage = require('behavior.storage');
const behaviorNonCombatant = require('behavior.noncombatant');

const MEMORY = require('constants.memory');
const TASKS = require('constants.tasks');
const TOPICS = require('constants.topics');

const behavior = behaviorTree.sequenceNode(
  'haul_task',
  [
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorTree.leafNode(
          'pick_haul_task',
          (creep, trace, kingdom) => {
            // lookup colony from kingdom
            const colonyId = creep.memory[MEMORY.MEMORY_COLONY];
            const colony = kingdom.getColonyById(colonyId);

            // get next haul task
            const task = colony.getNextRequest(TOPICS.TOPIC_HAUL_TASK);

            console.log('pick', creep.name, JSON.stringify(task));

            if (!task) {
              return FAILURE;
            }

            // set task details
            creep.memory[MEMORY.MEMORY_TASK_TYPE] = TASKS.TASK_HAUL;
            creep.memory[MEMORY.MEMORY_HAUL_PICKUP] = task.details[MEMORY.MEMORY_HAUL_PICKUP];
            creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] = task.details[MEMORY.MEMORY_HAUL_RESOURCE];

            if (creep.memory[MEMORY.MEMORY_HAUL_AMOUNT]) {
              creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] = task.details[MEMORY.MEMORY_HAUL_AMOUNT];
            } else {
              // Clear this, "needs energy" task was limiting regular haul tasks
              delete creep.memory[MEMORY.MEMORY_HAUL_AMOUNT];
            }

            creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] = task.details[MEMORY.MEMORY_HAUL_DROPOFF];

            return SUCCESS;
          },
        ),
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
    behaviorTree.leafNode(
      'load_resource',
      (creep, trace, kingdom) => {
        const pickup = Game.getObjectById(creep.memory[MEMORY.MEMORY_HAUL_PICKUP]);
        if (!pickup) {
          return FAILURE;
        }

        const amount = creep.memory[MEMORY.MEMORY_HAUL_AMOUNT] || undefined;
        console.log('pickup', creep.name, amount, JSON.stringify(creep.memory));

        const result = creep.withdraw(pickup, creep.memory[MEMORY.MEMORY_HAUL_RESOURCE], amount);
        console.log('withdrawl result', creep.name, result);

        if (result === ERR_FULL) {
          return SUCCESS;
        }
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
          if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) {
            return SUCCESS;
          }

          return FAILURE;
        }
        if (creep.store.getFreeCapacity() === 0) {
          return SUCCESS;
        }

        // If we are seeing a specific amount, we are done when we have that amount in the hold
        if (amount && creep.store.getUsedCapacity(RESOURCE_ENERGY) >= amount) {
          return SUCCESS;
        }

        if (result === OK) {
          return RUNNING;
        }

        return SUCCESS;
      },
    ),
    behaviorStorage.emptyCreep,
  ],
);

module.exports = {
  run: (creep, trace, kingdom) => {
    const roleTrace = trace.begin('hauler_v3');

    const result = behaviorNonCombatant(behavior).tick(creep, roleTrace, kingdom);
    if (result == behaviorTree.FAILURE) {
      console.log('INVESTIGATE: hauler_v3 failure', creep.name);
    }

    roleTrace.end();
  },
};
