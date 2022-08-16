import {behaviorBoosts} from './behavior.boosts';
import * as behaviorCommute from './behavior.commute';
import * as behaviorMovement from './behavior.movement';
import * as MEMORY from './constants.memory';
import {commonPolicy} from './constants.pathing_policies';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';
import {Tracer} from './lib/tracing';

const harvest = behaviorTree.leafNode(
  'harvest',
  (creep, trace, _kingdom) => {
    // If miner is full, then dump
    if (!creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
      const link = creep.pos.findInRange<StructureLink>(FIND_MY_STRUCTURES, 1, {
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
          trace.info('creep transfer to link', {result, amount});
          return RUNNING;
        }
      }
    }

    const destinationId = creep.memory[MEMORY.MEMORY_SOURCE];
    const destination = Game.getObjectById<Id<Source>>(destinationId);
    if (!destination) {
      trace.info('destination not found', {destinationId});
      return FAILURE;
    }

    if (destination.energy === 0) {
      return FAILURE;
    }

    const result = creep.harvest(destination);
    trace.info('harvest result', {result});

    if (result === ERR_NOT_IN_RANGE) {
      trace.info('not in range result', {result, destinationId});
      return FAILURE;
    }

    if (creep.store.getFreeCapacity() === 0) {
      trace.info('creep has no free capacity', {});
      return SUCCESS;
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      trace.info('not enough resources', {result});
      return FAILURE;
    }

    if (result === OK) {
      trace.info('ok result', {result});
      return RUNNING;
    }

    trace.info('harvest no ok', {result});

    return FAILURE;
  },
);

const buildNearbySites = behaviorTree.leafNode(
  'build_nearby_sites',
  (creep, trace, _kingdom) => {
    // if creep out of energy, refill if some available
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      return refillMiner(creep, trace);
    }

    const sites = creep.pos.findInRange(FIND_CONSTRUCTION_SITES, 1);
    if (!sites.length) {
      trace.info('no construction site', {});
      return FAILURE;
    }

    const result = creep.build(sites[0]);
    trace.info('build result', {result});

    return RUNNING;
  },
);

const repairContainer = behaviorTree.leafNode(
  'repair_container',
  (creep, trace, _kingdom) => {
    // if creep out of energy, refill if some available
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      return refillMiner(creep, trace);
    }

    const container = creep.pos.lookFor(LOOK_STRUCTURES).find((site) => {
      return site.structureType === STRUCTURE_CONTAINER;
    }) as StructureContainer;
    if (!container) {
      trace.info('no container', {pos: creep.pos});
      return FAILURE;
    }

    if (container.hits === container.hitsMax) {
      trace.info('container full health', {hits: container.hits});
      return FAILURE;
    }

    const result = creep.repair(container);
    trace.info('repair result', {result});

    return RUNNING;
  },
);

const moveEnergyToLink = behaviorTree.leafNode(
  'move_energy_to_link',
  (creep, trace, _kingdom) => {
    const source = Game.getObjectById<Id<Source>>(creep.memory[MEMORY.MEMORY_SOURCE]);
    if (!source) {
      trace.info('source not found');
      return FAILURE;
    }

    if (source.energy > 0) {
      trace.info('source has energy, stop trying to load link');
      return SUCCESS;
    }

    const link = creep.pos.findInRange<StructureLink>(FIND_MY_STRUCTURES, 1, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_LINK;
      },
    })[0];

    if (!link) {
      trace.info('no link');
      return FAILURE;
    }

    let target: AnyStructure | Resource = null;

    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    trace.info('creep free capacity', {freeCapacity});
    if (freeCapacity > 0) {
      target = creep.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_CONTAINER &&
            structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        },
      })[0];
      if (target) {
        const result = creep.withdraw(target, RESOURCE_ENERGY);
        trace.info('withdraw energy', {result, targetId: target.id});
        return RUNNING;
      }

      target = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
        filter: (resource) => {
          return resource.resourceType === RESOURCE_ENERGY;
        },
      })[0];
      if (target) {
        const result = creep.pickup(target);
        trace.info('pickup energy', {result, targetId: target.id});
        return RUNNING;
      }

      trace.info('found no energy to pickup');
      return FAILURE;
    }

    if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      const result = creep.transfer(link, RESOURCE_ENERGY);
      trace.info('transfer energy to link', {result});
    }

    return RUNNING;
  },
);

const waitUntilSourceReady = behaviorTree.leafNode(
  'wait_until_ready',
  (creep) => {
    const source = Game.getObjectById<Id<Source>>(creep.memory[MEMORY.MEMORY_SOURCE]);
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

// Refill creep with nearby dropped resources or container
function refillMiner(creep: Creep, trace: Tracer) {
  const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
    filter: (resource) => {
      return resource.resourceType === RESOURCE_ENERGY;
    }
  })[0];
  if (dropped) {
    const result = creep.pickup(dropped);
    if (result !== OK) {
      trace.info('pickup not ok', {result});
      return FAILURE;
    }

    trace.info('pickup ok', {result});
    return RUNNING;
  }

  const container = creep.pos.findInRange<StructureContainer>(FIND_STRUCTURES, 1, {
    filter: (structure) => {
      return structure.structureType === STRUCTURE_CONTAINER;
    },
  })[0];
  if (container) {
    if (container.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      trace.info('no energy in container', {store: container.store});
      return FAILURE;
    }

    const result = creep.withdraw(container, RESOURCE_ENERGY);
    if (result !== OK) {
      trace.info('withdraw not ok', {result});
      return FAILURE;
    }

    trace.info('withdraw ok', {result});
    return RUNNING;
  }

  trace.info('no energy to pick up', {pos: creep.pos});
  return FAILURE;
}

const behavior = behaviorTree.sequenceNode(
  'mine_energy',
  [
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_SOURCE_POSITION, 0, commonPolicy),
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
              buildNearbySites,
              repairContainer,
              moveEnergyToLink,
              waitUntilSourceReady,
            ],
          ),
        ],
      ),
    ),
  ],
);

export const roleMiner = {
  run: behaviorTree.rootNode('miner', behaviorBoosts(behavior)),
};
