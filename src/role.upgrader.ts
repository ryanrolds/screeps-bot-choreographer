import * as behaviorTree from "./lib.behaviortree";
import * as behaviorAssign from "./behavior.assign";
import * as behaviorMovement from "./behavior.movement";
import * as behaviorCommute from "./behavior.commute";
import {behaviorBoosts} from "./behavior.boosts";
import behaviorRoom from "./behavior.room";
import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./lib.pathing_policies";
import {roadWorker} from "./behavior.logistics";

const behavior = behaviorTree.sequenceNode(
  'upgrader_root',
  [
    behaviorRoom.getSomeEnergy,
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.leafNode('set_controller_location', (creep, trace, kingdom) => {
      const assignedRoom = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];

      const roomEntry = kingdom.getScribe().getRoomById(assignedRoom);
      if (!roomEntry?.controller?.pos) {
        trace.error('no controller pos', {assignedRoom});
        return behaviorTree.FAILURE;
      }

      const pos = roomEntry.controller.pos;
      const posStr = [pos.x, pos.y, pos.roomName].join(',');

      creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = posStr;

      return behaviorTree.SUCCESS;
    }),
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 3, commonPolicy),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilSuccess(
      'upgrade_until_empty',
      behaviorTree.leafNode(
        'upgrade_controller',
        (creep, trace, kingdom) => {
          const result = creep.upgradeController(creep.room.controller);
          trace.log("upgrade result", {result})
          if (result == ERR_NOT_ENOUGH_RESOURCES) {
            return behaviorTree.SUCCESS;
          }

          if (result != OK) {
            return behaviorTree.FAILURE;
          }

          return behaviorTree.RUNNING;
        },
      ),
    ),
    behaviorRoom.updateSign,
  ],
);


export const roleUpgrader = {
  run: behaviorTree.rootNode('upgrader', behaviorBoosts(roadWorker(behavior))),
};
