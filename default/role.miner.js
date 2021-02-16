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

const waitUntilSourceReady = behaviorTree.leafNode(
  'waitUntilReady',
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
              waitUntilSourceReady,
            ],
          ),
        ],
      ),
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('miner', behaviorNonCombatant(behavior)),
};
