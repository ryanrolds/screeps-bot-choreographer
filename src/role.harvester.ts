
/**
 * Harvester creep
 *
 * Harvests mineral nodes.
 */
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";
import * as behaviorCommute from "./behavior.commute";
import behaviorStorage from "./behavior.storage";
import * as behaviorMovement from "./behavior.movement";
import {build, selectInfrastructureSites} from "./behavior.build";
import * as behaviorHarvest from "./behavior.harvest";
import {behaviorBoosts} from "./behavior.boosts";
import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./constants.pathing_policies";
import {roadWorker} from "./behavior.logistics";

const behavior = behaviorTree.sequenceNode(
  'haul_energy',
  [
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_SOURCE_POSITION, 0, commonPolicy),
    behaviorCommute.setCommuteDuration,
    behaviorHarvest.harvest,
    behaviorTree.sequenceNode(
      'dump',
      [
        behaviorStorage.selectRoomDropoff,
        behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, commonPolicy),
        behaviorTree.leafNode(
          'empty_creep',
          (creep, trace, kingdom) => {
            if (creep.store.getUsedCapacity() === 0) {
              return SUCCESS;
            }

            const destination = Game.getObjectById<Id<Structure<StructureConstant>>>(creep.memory[MEMORY.MEMORY_DESTINATION]);
            if (!destination) {
              trace.log('no destination', {destination: creep.memory[MEMORY.MEMORY_DESTINATION]});
              return SUCCESS;
            }

            const resource = Object.keys(creep.store).pop();
            const result = creep.transfer(destination, resource as ResourceConstant);
            trace.log('transfer', {result, resource});

            if (result !== OK) {
              trace.error('transfer failed', {result});
              return FAILURE;
            }

            return RUNNING;
          },
        ),
      ],
    ),
  ],
);

export const roleHarvester = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
