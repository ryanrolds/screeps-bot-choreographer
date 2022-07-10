import {behaviorBoosts} from './behavior.boosts';
import * as behaviorCommute from './behavior.commute';
import {roadWorker} from './behavior.logistics';
import * as behaviorMovement from './behavior.movement';
import * as behaviorRoom from './behavior.room';
import * as MEMORY from './constants.memory';
import * as behaviorTree from './lib.behaviortree';
import {AllowedCostMatrixTypes} from './lib.costmatrix_cache';
import {FindPathPolicy} from './lib.pathing';

export const controllerDumpPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.COMMON,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 12,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
  },
};

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
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 3, controllerDumpPolicy),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilSuccess(
      'upgrade_until_empty',
      behaviorTree.leafNode(
        'upgrade_controller',
        (creep, trace, kingdom) => {
          const result = creep.upgradeController(creep.room.controller);
          trace.log('upgrade result', {result});
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
