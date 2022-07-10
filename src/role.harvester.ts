
/**
 * Harvester creep
 *
 * Harvests mineral nodes.
 */
import {behaviorBoosts} from "./behavior.boosts";
import * as behaviorCommute from "./behavior.commute";
import * as behaviorHarvest from "./behavior.harvest";
import {roadWorker} from "./behavior.logistics";
import * as behaviorMovement from "./behavior.movement";
import * as behaviorStorage from "./behavior.storage";
import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./constants.pathing_policies";
import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, RUNNING, SUCCESS} from "./lib.behaviortree";

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
