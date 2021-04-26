const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorBoosts = require('./behavior.boosts');
const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');
const MEMORY = require('./constants.memory');

const selectSource = behaviorTree.leafNode(
  'selectSource',
  (creep, trace, kingdom) => {
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
          trace.log('creep transfer to link', {result, amount});
          return RUNNING;
        }
      }
    }

    const destinationId = creep.memory[MEMORY.MEMORY_HARVEST];
    const destination = Game.getObjectById(destinationId);
    if (!destination) {
      trace.log('destination not found', {destinationId});
      return FAILURE;
    }

    const result = creep.harvest(destination);
    trace.log('harvest result', {result});

    if (result === ERR_NOT_IN_RANGE) {
      trace.log('not in range result', {result, destinationId});
      return FAILURE;
    }

    if (result === ERR_FULL) {
      trace.log('full result', {result});
      return SUCCESS;
    }

    if (creep.store.getFreeCapacity() === 0) {
      trace.log('creep has no free capacity', {});
      return SUCCESS;
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      trace.log('not enough resources', {result});
      return FAILURE;
    }

    if (result === OK) {
      trace.log('ok result', {result});
      return RUNNING;
    }

    trace.log('harvest no ok', {result});

    return FAILURE;
  },
);

const moveEnergyToLink = behaviorTree.leafNode(
  'move_energy_to_link',
  (creep, trace, kingdom) => {
    const link = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_LINK;
      },
    })[0];

    if (!link) {
      trace.log('no link');
      return FAILURE;
    }

    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.log('creep free capacity', {freeCapacity});
    if (freeCapacity > 0) {
      const target = creep.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_CONTAINER &&
            structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        },
      })[0];
      if (target) {
        const result = creep.withdraw(target, RESOURCE_ENERGY);
        trace.log('withdraw energy', {result, targetId: target.id});
        return RUNNING;
      }

      target = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: (resource) => {
          return resource.resourceType === RESOURCE_ENERGY;
        },
      })[0];
      if (target) {
        const result = creep.pickup(target);
        trace.log('pickup energy', {result, targetId: target.id});
        return RUNNING;
      }

      trace.log('found no energy to pickup');
      return FAILURE;
    }

    if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      const result = creep.transfer(link, RESOURCE_ENERGY);
      trace.log('transfer energy to link', {result});
    }

    return RUNNING;
  },
);

const waitUntilSourceReady = behaviorTree.leafNode(
  'wait_until_ready',
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
              moveEnergyToLink,
              waitUntilSourceReady,
            ],
          ),
        ],
      ),
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('miner', behaviorBoosts(behaviorNonCombatant(behavior))),
};
