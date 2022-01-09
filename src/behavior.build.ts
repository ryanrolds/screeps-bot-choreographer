import * as behaviorTree from './lib.behaviortree';
import {FAILURE, SUCCESS, RUNNING} from './lib.behaviortree';
import * as behaviorMovement from './behavior.movement';
import {MEMORY_DESTINATION, MEMORY_FLAG} from './constants.memory';
import {getPrioritizedSites} from './lib.construction';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';

export const selectSite = behaviorTree.leafNode(
  'selectSite',
  (creep: Creep, trace: Tracer, kingdom: Kingdom) => {
    let sites = getPrioritizedSites(creep.room);
    if (sites.length === 0) {
      return FAILURE;
    }

    const baseConfig = kingdom.getCreepBaseConfig(creep);
    if (!baseConfig) {
      trace.error('No base config for creep');
      return FAILURE;
    }

    // Sort sites by distance from base origin, this ensures the base is built first
    _.sortBy(sites, (site) => {
      return site.pos.getRangeTo(baseConfig.origin);
    });

    const site = sites[0];
    behaviorMovement.setDestination(creep, site.id, site.room.name);
    return behaviorTree.SUCCESS;
  },
);

export const selectSiteNearFlag = behaviorTree.leafNode(
  'selectSiteNearFlag',
  (creep) => {
    const flagID = creep.memory[MEMORY_FLAG];
    if (!flagID) {
      return FAILURE;
    }

    const flag = Game.flags[flagID];
    if (!flag) {
      return FAILURE;
    }

    if (!flag.room) {
      return FAILURE;
    }

    const target = flag.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
    if (!target) {
      return FAILURE;
    }

    behaviorMovement.setDestination(creep, target.id, target.room.name);
    return SUCCESS;
  },
);

export const build = behaviorTree.leafNode(
  'build',
  (creep) => {
    const destination = Game.getObjectById<Id<ConstructionSite>>(creep.memory[MEMORY_DESTINATION]);
    if (!destination) {
      return FAILURE;
    }

    const result = creep.build(destination);
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return SUCCESS;
    }
    if (result === ERR_INVALID_TARGET) {
      return FAILURE;
    }
    if (result != OK) {
      return FAILURE;
    }
    if (creep.store.getUsedCapacity() === 0) {
      return SUCCESS;
    }

    return RUNNING;
  },
);
