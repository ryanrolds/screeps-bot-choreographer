const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');
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
  (creep, trace, kingdom) => {
    if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
      const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK;
        },
      })[0];

      if (link) {
        const amount = _.min(
          [
            link.store.getFreeCapacity(RESOURCE_ENERGY),
            creep.store.getUsedCapacity(RESOURCE_ENERGY),
          ],
        );

        if (amount) {
          const result = creep.transfer(link, RESOURCE_ENERGY, amount);
          trace.log(creep.id, 'creep transfer to link', {result, amount});
          return RUNNING;
        }
      }
    }

    const destinationId = creep.memory[MEMORY.MEMORY_HARVEST];
    const destination = Game.getObjectById(destinationId);
    if (!destination) {
      trace.log(creep.id, 'destination not found', {destinationId});
      return FAILURE;
    }

    const result = creep.harvest(destination);
    trace.log(creep.id, 'harvest result', {result});

    if (result === ERR_NOT_IN_RANGE) {
      trace.log(creep.id, 'not in range result', {result, destinationId});
      return FAILURE;
    }

    if (result === ERR_FULL) {
      trace.log(creep.id, 'full result', {result});
      return SUCCESS;
    }

    if (creep.store.getFreeCapacity() === 0) {
      trace.log(creep.id, 'creep has no free capacity', {});
      return SUCCESS;
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      trace.log(creep.id, 'not enough resources', {result});
      return FAILURE;
    }

    if (result === OK) {
      trace.log(creep.id, 'ok result', {result});
      return RUNNING;
    }

    trace.log(creep.id, 'harvest no ok', {result});

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

    if (creep.pos.getRangeTo(source) > 1) {
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
    selectSource,
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 0, false, 50, 1500),
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
              // TODO dump energy in link
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
