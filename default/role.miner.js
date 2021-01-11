const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');
const behaviorHarvest = require('./behavior.harvest');
const MEMORY = require('./constants.memory');

const selectSource = behaviorTree.leafNode(
  'selectSource',
  (creep) => {
    const source = Game.getObjectById(creep.memory[MEMORY.MEMORY_HARVEST]);
    const container = Game.getObjectById(creep.memory[MEMORY.MEMORY_HARVEST_CONTAINER]);
    if (source && container) {
      behaviorMovement.setSource(creep, source.id);
      behaviorMovement.setDestination(creep, container.id);
      return SUCCESS;
    }

    return FAILURE;
  },
);

const harvest = behaviorTree.leafNode(
  'fill_creep',
  (creep) => {
    const destination = Game.getObjectById(creep.memory.source);
    if (!destination) {
      return FAILURE;
    }

    const result = creep.harvest(destination);
    if (result === ERR_FULL) {
      return SUCCESS;
    }
    if (creep.store.getFreeCapacity() === 0) {
      return SUCCESS;
    }
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return FAILURE;
    }
    if (result === OK) {
      return RUNNING;
    }

    return FAILURE;
  },
);

const janitor = behaviorTree.leafNode(
  'janitor',
  (creep) => {
    // Locate dropped resource close to creep
    const resource = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1);
    if (!resource) {
      return FAILURE;
    }

    const container = Game.getObjectById(creep.memory[MEMORY.MEMORY_HARVEST_CONTAINER])

    console.log(container)

    if (!container) {
      return FAILURE
    }

    if (container.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      return FAILURE
    }

    const result = creep.pickup(resource[0]);

    console.log(creep.name, "pickup", result)

    if (result === ERR_FULL) {
      // We still have energy to transfer, fail so we find another
      // place to dump
      return SUCCESS;
    }
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return SUCCESS;
    }
    if (creep.store.getUsedCapacity() === 0) {
      return SUCCESS;
    }
    if (result != OK) {
      return FAILURE;
    }

    return RUNNING;
  },
);

const emptyCreep = behaviorTree.sequenceNode(
  'empty_creep',
  [
    behaviorTree.leafNode(
      'pick_adjacent_container',
      (creep) => {
        const targets = creep.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTAINER &&
              structure.structureType == STRUCTURE_CONTAINER &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        if (!targets || !targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'move_to_destination',
      (creep) => {
        const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
        if (!destination) {
          return FAILURE;
        }

        const result = creep.moveTo(destination);
        if (result === ERR_NO_PATH) {
          return FAILURE;
        }
        if (result !== OK && result !== ERR_TIRED) {
          return FAILURE;
        }

        if (creep.pos.inRangeTo(destination, 1)) {
          return SUCCESS;
        }

        return RUNNING;
      },
    ),
    behaviorTree.leafNode(
      'transfer_energy',
      (creep) => {
        const destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION]);
        if (!destination) {
          return FAILURE;
        }

        if (destination.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
          return SUCCESS;
        }

        const result = creep.transfer(destination, RESOURCE_ENERGY);

        console.log(creep.name, "transfer", result)

        if (result === ERR_FULL) {
          // We still have energy to transfer, fail so we find another
          // place to dump
          return FAILURE;
        }
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
          return SUCCESS;
        }
        if (creep.store.getUsedCapacity() === 0) {
          return SUCCESS;
        }
        if (result != OK) {
          return FAILURE;
        }

        return RUNNING;
      },
    ),
  ],
);

const waitUntilSourceReady = behaviorTree.leafNode(
  'selectSource',
  (creep) => {
    const source = Game.getObjectById(creep.memory[MEMORY.MEMORY_HARVEST]);
    if (!source) {
      return FAILURE;
    }

    if (source.energy < 1) {
      return RUNNING;
    }

    return SUCCESS;
  },
);

const behavior = behaviorTree.sequenceNode(
  'mine_energy',
  [
    behaviorHarvest.moveToHarvestRoom,
    selectSource,
    behaviorMovement.moveToDestination(0),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilFailure(
      'mine_until_failure',
      behaviorTree.sequenceNode(
        'get_energy_and_dump',
        [
          behaviorTree.selectorNode(
            'get_energy',
            [
              harvest,
              janitor,
              waitUntilSourceReady,
            ],
          ),
          emptyCreep,
        ]
      )
    ),
  ],
);

module.exports = {
  run: (creep, trace, kingdom) => {
    const roleTrace = trace.begin('miner');

    const result = behaviorNonCombatant(behavior).tick(creep, roleTrace, kingdom);
    if (result == behaviorTree.FAILURE) {
      console.log('INVESTIGATE: miner failure', creep.name);
    }

    roleTrace.end();
  },
};
