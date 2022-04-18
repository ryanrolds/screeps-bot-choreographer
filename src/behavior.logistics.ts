
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";

export const roadWorker = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'build_repair_road_and_do_behavior',
    [
      behaviorTree.leafNode(
        'build_repair_road',
        (creep, trace, kingdom) => {
          // If energy too low, do not build/repair roads
          if (creep.store.getUsedCapacity(RESOURCE_ENERGY) <= creep.store.getCapacity(RESOURCE_ENERGY) * 0.9) {
            return SUCCESS;
          }

          // If work parts, do not build/repair roads
          if (creep.getActiveBodyparts(WORK) === 0) {
            return SUCCESS;
          }

          // Check for road to repair
          const road = creep.pos.lookFor(LOOK_STRUCTURES).find((structure) => {
            return structure.structureType === STRUCTURE_ROAD;
          });
          if (road && road.hitsMax - road.hits > 100) {
            const result = creep.repair(road);
            if (result !== OK) {
              trace.error('repair error', {
                result,
                roadPosition: [road.pos.x, road.pos.y, road.pos.roomName].join(',')
              });
            }
            return SUCCESS;
          }

          // Check for road to build
          const constructionSite = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).find((structure) => {
            return structure.structureType === STRUCTURE_ROAD;
          });
          if (constructionSite) {
            const result = creep.build(constructionSite);
            if (result !== OK) {
              trace.error('build error', {result});
            }
            return SUCCESS;
          }

          return SUCCESS;
        }
      ),
      behaviorNode,
    ]
  );
};
