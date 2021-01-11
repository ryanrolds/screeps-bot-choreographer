
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const behaviorStorage = require('./behavior.storage');
const {MEMORY_DESTINATION} = require('./constants.memory');

// The goal is to not tell two  Distributors to go to the same structure needing
// energy. So, we lookup all the currently assigned destinations and subtract those
// from the list of structures needing energy. Then we find the closest structure
// needing energy
const selectDestination = behaviorTree.leafNode(
  'select_distributor_transfer',
  (creep, trace, kingdom) => {
    const room = kingdom.getCreepRoom(creep);
    if (!room) {
      return FAILURE;
    }

    const structure = room.getNextEnergyStructure(creep);
    if (!structure) {
      console.log("getNextEnergyStructure returns falsey", creep.name)
      return RUNNING;
    }

    behaviorMovement.setDestination(creep, structure.id);
    return SUCCESS;
  },
);

const behavior = behaviorTree.sequenceNode(
  'distributor_root',
  [
    behaviorStorage.fillCreep,
    behaviorTree.repeatUntilSuccess(
      'transfer_until_empty',
      behaviorTree.sequenceNode(
        'dump_energy',
        [
          selectDestination,
          behaviorMovement.moveToDestination(1),
          behaviorTree.leafNode(
            'empty_creep',
            (creep) => {
              const destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION]);
              if (!destination) {
                return FAILURE;
              }

              const result = creep.transfer(destination, RESOURCE_ENERGY);

              if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
                return SUCCESS;
              }

              if (result === ERR_FULL) {
                return FAILURE;
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
    ),
  ],
);

module.exports = {
  run: (creep, trace, kingdom) => {
    const roleTrace = trace.begin('distributor');

    const result = behavior.tick(creep, roleTrace, kingdom);
    if (result == behaviorTree.FAILURE) {
      console.log('INVESTIGATE: distributor failure', creep.name);
    }

    roleTrace.end();
  },
};
