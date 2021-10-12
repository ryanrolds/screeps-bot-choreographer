import * as behaviorTree from "./lib.behaviortree";
import behaviorCommute from "./behavior.commute";
import * as behaviorMovement from "./behavior.movement";
import behaviorBuild from "./behavior.build";
import behaviorRoom from "./behavior.room";
import {behaviorBoosts} from "./behavior.boosts";

import * as MEMORY from "./constants.memory";
import {common} from "./lib.pathing_policies";

const behavior = behaviorTree.sequenceNode(
  'builder_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.leafNode('set_controller_location', (creep, trace, kingdom) => {
      const assignedRoom = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];

      let posStr = [25, 25, assignedRoom].join(',');

      const roomEntry = kingdom.getScribe().getRoomById(assignedRoom);
      if (roomEntry?.controller?.pos) {
        const pos = roomEntry.controller?.pos;
        posStr = [pos.x, pos.y, pos.roomName].join(',');
      }

      creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = posStr;

      return behaviorTree.SUCCESS;
    }),
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 3, common),
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.sequenceNode(
      'build_construction_site',
      [
        behaviorTree.selectorNode(
          'pick_something',
          [
            behaviorBuild.selectSite,
            behaviorRoom.parkingLot,
          ],
        ),
        behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, common),
        behaviorBuild.build,
      ],
    ),
  ],
);

export const roleBuilder = {
  run: behaviorTree.rootNode('builder', behaviorBoosts(behavior)),
};
