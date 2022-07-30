import {behaviorBoosts} from './behavior.boosts';
import * as behaviorCommute from './behavior.commute';
import * as behaviorMovement from './behavior.movement';
import * as MEMORY from './constants.memory';
import {commonPolicy} from './constants.pathing_policies';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';

const selectSource = behaviorTree.leafNode(
  'selectSource',
  (creep, trace, kingdom) => {
    const source = Game.getObjectById<Id<Source>>(creep.memory[MEMORY.MEMORY_SOURCE]);
    const container = Game.getObjectById<Id<StructureContainer>>(creep.memory[MEMORY.MEMORY_SOURCE_CONTAINER]);

    if (source && container) {
      behaviorMovement.setSource(creep, source.id);
      behaviorMovement.setDestination(creep, container.id);
      return SUCCESS;
    } else if (source) {
      behaviorMovement.setSource(creep, source.id);
      behaviorMovement.setDestination(creep, source.id);
      return SUCCESS;
    }

    return FAILURE;
  },
);

const harvest = behaviorTree.leafNode(
  'fill_creep',
  (creep, trace, kingdom) => {
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
  (creep, trace, kingdom) => {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      trace.info('no energy to build container', {});
      return FAILURE;
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
  (creep, trace, kingdom) => {
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      trace.info('no energy to repair container', {});
      return FAILURE;
    }

    const container = creep.pos.lookFor(LOOK_STRUCTURES).find((site) => {
      return site.structureType === STRUCTURE_CONTAINER;
    });

    if (!container) {
      trace.info('no construction site', {});
      return FAILURE;
    }

    if (container.hits === container.hitsMax) {
      trace.info('container full health');
      return FAILURE;
    }

    const result = creep.repair(container);
    trace.info('repair result', {result});

    return RUNNING;
  },
);

const moveEnergyToLink = behaviorTree.leafNode(
  'move_energy_to_link',
  (creep, trace, kingdom) => {
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
