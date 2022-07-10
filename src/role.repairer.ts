import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, RUNNING, SUCCESS} from "./lib.behaviortree";

import * as behaviorAssign from "./behavior.assign";
import {behaviorBoosts} from "./behavior.boosts";
import * as behaviorCommute from "./behavior.commute";
import * as behaviorMovement from "./behavior.movement";

import {getCreepBase, getNextDamagedStructure} from "./base";
import {getEnergy} from "./behavior.room";
import {MEMORY_DESTINATION} from "./constants.memory";
import {Kernel} from "./kernel";
import {Tracer} from "./lib.tracing";

const selectStructureToRepair = behaviorTree.leafNode(
  'selectStructureToRepair',
  (creep: Creep, trace: Tracer, kernel: Kernel) => {
    const base = getCreepBase(kernel, creep);
    if (!base) {
      trace.error('no room on creep', {name: creep.name, memory: creep.memory});
      creep.suicide();
      return FAILURE;
    }

    const target = getNextDamagedStructure(base);
    if (!target) {
      return FAILURE;
    }

    trace.log("selected target", {target: target.id, pos: target.pos});

    behaviorMovement.setDestination(creep, target.id);

    return SUCCESS;
  },
);

const repair = behaviorTree.leafNode(
  'repair_structure',
  (creep, trace, kingdom) => {
    const destination = Game.getObjectById<Structure>(creep.memory[MEMORY_DESTINATION]);
    if (!destination) {
      return FAILURE;
    }

    // TODO this should not be a failure, I need to makea RepeatCondition node
    if (destination.hits >= destination.hitsMax) {
      return SUCCESS;
    }

    const result = creep.repair(destination);
    trace.log('repairing', {destination: destination.id, result});
    if (result != OK) {
      return FAILURE;
    }

    return RUNNING;
  },
);

const behavior = behaviorTree.sequenceNode(
  'repair',
  [
    behaviorAssign.moveToRoom,
    behaviorCommute.setCommuteDuration,
    getEnergy,
    behaviorTree.repeatUntilConditionMet(
      'repair_until_empty',
      (creep, trace, kingdom) => {
        if (creep.store.getUsedCapacity() === 0) {
          return true;
        }

        return false;
      },
      behaviorTree.sequenceNode(
        'select_and_repair',
        [
          selectStructureToRepair,
          behaviorMovement.moveToCreepMemory(MEMORY_DESTINATION, 1, false, 50, 1000),
          repair,
        ],
      ),
    ),
  ],
);

export const roleRepairer = {
  run: behaviorTree.rootNode('repairer', behaviorBoosts(behavior)),
};
