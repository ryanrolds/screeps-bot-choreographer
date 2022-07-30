import * as behaviorMovement from './behavior.movement';
import {MEMORY_ASSIGN_ROOM} from './constants.memory';
import * as behaviorTree from './lib.behaviortree';
import {AllowedCostMatrixTypes} from './lib.costmatrix_cache';
import {FindPathPolicy} from './lib.pathing';

const explorerPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: false,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: false,
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
    sourceKeeperBuffer: 3,
    hostileCreepBuffer: 8,
  },
};

const behavior = behaviorTree.sequenceNode(
  'explorer_root',
  [
    behaviorTree.leafNode(
      'select_next_room',
      (creep, trace, kingdom) => {
        // Don't notify me when creep wonders into hostile room
        creep.notifyWhenAttacked(false);

        // If creep is assigned room it is not in, then move to that room
        if (creep.memory[MEMORY_ASSIGN_ROOM] && creep.pos.roomName !== creep.memory[MEMORY_ASSIGN_ROOM]) {
          trace.info('creep is assigned room already, moving to it');
          return behaviorTree.SUCCESS;
        }

        const currentRoomStatus = Game.map.getRoomStatus(creep.room.name);
        let exits = Object.values(Game.map.describeExits(creep.room.name));
        exits = exits.filter((exit) => {
          const exitStatus = Game.map.getRoomStatus(exit);
          return currentRoomStatus.status === exitStatus.status;
        });

        let entries = exits.map((roomId) => {
          const entry = kingdom.getScribe().getRoomById(roomId);

          return {
            id: roomId,
            lastUpdated: (entry) ? entry.lastUpdated : 0,
          };
        });

        entries = _.sortBy(entries, 'lastUpdated');

        trace.info('next room', {next: entries[0].id});
        creep.memory[MEMORY_ASSIGN_ROOM] = entries[0].id;
        return behaviorTree.SUCCESS;
      },
    ),
    behaviorMovement.cachedMoveToRoom(MEMORY_ASSIGN_ROOM, explorerPolicy),
    behaviorTree.leafNode(
      'move_into_room',
      (creep, trace, kingdom) => {
        // Record room
        kingdom.getScribe().updateRoom(kingdom, creep.room, trace);

        // Move one step into the room
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), {maxOps: 100});

        return behaviorTree.SUCCESS;
      },
    ),
  ],
);

export const roleExplorer = {
  run: behaviorTree.rootNode('explorer', behavior),
};
