
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";

export const roadWorker = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'build_and_repair_road',
    [
      behaviorTree.leafNode(
        'build_and_repair_road',
        (creep, trace, kingdom) => {
          if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= 100) {
            return SUCCESS;
          }

          const road = creep.pos.lookFor(LOOK_STRUCTURES).find((structure) => {
            return structure.structureType === STRUCTURE_ROAD;
          });
          if (road && road.hitsMax - road.hits > 100) {
            const result = creep.repair(road);
            trace.log('repair result', {result});
            return SUCCESS;
          }

          const constructionSite = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).find((structure) => {
            return structure.structureType === STRUCTURE_ROAD;
          });
          if (constructionSite) {
            const result = creep.build(constructionSite);
            trace.log('build result', {result});
            return SUCCESS;
          }

          return SUCCESS;
        }
      ),
      behaviorNode,
    ]
  );
};
