import * as behaviorTree from "./lib.behaviortree";
import {FAILURE, SUCCESS, RUNNING} from "./lib.behaviortree";

import * as behaviorMovement from "./behavior.movement";
import behaviorCommute from "./behavior.commute";
import * as behaviorAssign from "./behavior.assign";
import behaviorRoom from "./behavior.room";
import {behaviorBoosts} from "./behavior.boosts";

import {MEMORY_DESTINATION} from "./constants.memory";
import {trace} from "console";

const selectStructureToRepair = behaviorTree.leafNode(
  'selectStructureToRepair',
  (creep, trace, kingdom) => {
    const room = kingdom.getCreepRoom(creep);
    if (!room) {
      trace.error('no room on creep', {name: creep.name, memory: creep.memory});
      creep.suicide();
      return FAILURE;
    }

    const target = room.getNextDamagedStructure();
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
    behaviorRoom.getEnergy,
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
          behaviorMovement.moveToDestination(1, false, 50, 1000),
          repair,
        ],
      ),
    ),
  ],
);

export const roleRepairer = {
  run: behaviorTree.rootNode('repairer', behaviorBoosts(behavior)),
};
