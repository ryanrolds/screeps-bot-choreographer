import {getNextRoomToScout} from '../../base/scouting';
import {MEMORY_ASSIGN_ROOM} from '../../constants/memory';
import {AllowedCostMatrixTypes} from '../../lib/costmatrix_cache';
import {FindPathPolicy} from '../../lib/pathing';
import * as behaviorTree from '../behavior/behaviortree';
import * as behaviorMovement from '../behavior/movement';

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
        if (creep.memory[MEMORY_ASSIGN_ROOM] &&
          creep.pos.roomName !== creep.memory[MEMORY_ASSIGN_ROOM]) {
          trace.info('creep is assigned room already, moving to it');
          return behaviorTree.SUCCESS;
        }

        const nextRoom = getNextRoomToScout(kingdom, creep);
        if (nextRoom) {
          trace.notice(`found next room to scout: ${nextRoom}`);
          creep.memory[MEMORY_ASSIGN_ROOM] = nextRoom;
          return behaviorTree.SUCCESS;
        }

        trace.info('no next room to scout');

        const currentRoomStatus = Game.map.getRoomStatus(creep.room.name);
        let exits = Object.values(Game.map.describeExits(creep.room.name));
        exits = exits.filter((exit) => {
          const exitStatus = Game.map.getRoomStatus(exit);
          return currentRoomStatus.status === exitStatus.status;
        });

        // Unvisited exists first
        const unvisited = exits.filter((roomName) => {
          const entry = kingdom.getScribe().getRoomById(roomName);
          return !entry;
        });
        if (unvisited.length > 0) {
          trace.info('unvisited exits', {unvisited});
          creep.memory[MEMORY_ASSIGN_ROOM] = unvisited[0];
          return behaviorTree.SUCCESS;
        }

        // Try to pick oldest room first if it hasn't been visited recently
        const ageSorted = _.sortBy(exits, (roomName) => {
          const entry = kingdom.getScribe().getRoomById(roomName);
          return entry.lastUpdated;
        });
        const oldestRoom = kingdom.getScribe().getRoomById(ageSorted[0]);
        if (Game.time - oldestRoom.lastUpdated > 50) {
          trace.info('age sorted exits', {ageSorted});
          creep.memory[MEMORY_ASSIGN_ROOM] = ageSorted[0];
          return behaviorTree.SUCCESS;
        }

        // All exits are recently visited, pick random exit
        const shuffled = _.shuffle(exits);
        trace.info('next room', {next: shuffled[0]});
        creep.memory[MEMORY_ASSIGN_ROOM] = shuffled[0];
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
