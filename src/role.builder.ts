import * as behaviorTree from "./lib.behaviortree";
import behaviorCommute from "./behavior.commute";
import * as behaviorMovement from "./behavior.movement";
import {build, selectSite} from "./behavior.build";
import behaviorRoom from "./behavior.room";
import {behaviorBoosts} from "./behavior.boosts";

import * as MEMORY from "./constants.memory";
import {commonPolicy} from "./lib.pathing_policies";

const behavior = behaviorTree.sequenceNode(
  'builder_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.repeatUntilConditionMet(
      'move_to_room',
      (creep, trace, kingdom) => {
        const assignedRoom = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
        // If creep doesn't have a room assigned, we are done
        if (!assignedRoom) {
          return true;
        }

        // If the creep reaches the room we are done
        if (creep.room.name === assignedRoom) {
          return true;
        }

        return false;
      },
      behaviorTree.sequenceNode(
        'move_to_room_controller',
        [
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
          behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 3, commonPolicy),
        ]
      ),
    ),
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.repeatUntilConditionMet(
      'build_sites',
      (creep, trace, kingdom) => {
        return creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0;
      },
      behaviorTree.sequenceNode(
        'build_construction_site',
        [
          behaviorTree.selectorNode(
            'pick_something',
            [
              selectSite,
              behaviorRoom.parkingLot,
            ],
          ),
          behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 3, commonPolicy),
          build,
        ],
      ),
    )
  ],
);

export const roleBuilder = {
  run: behaviorTree.rootNode('builder', behaviorBoosts(behavior)),
};
