
import * as behaviorTree from './lib.behaviortree';
import {FAILURE} from './lib.behaviortree';
import behaviorCommute from "./behavior.commute";
import * as behaviorMovement from "./behavior.movement";
import {behaviorBoosts} from "./behavior.boosts";
import behaviorRoom from "./behavior.room";
import * as MEMORY from "./constants.memory";
import {PathFinderPolicy} from './lib.path_cache';

const policy: PathFinderPolicy = {
  avoidHostiles: true,
  avoidOwnedRooms: true,
  avoidFriendlyRooms: false,
  maxOps: 3000,
}

const behavior = behaviorTree.sequenceNode(
  'reserver_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.leafNode('set_controller_location', (creep, trace, kingdom) => {
      const assignedRoom = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = [25, 25, assignedRoom].join(',');

      return behaviorTree.SUCCESS
    }),
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 1, 4000, policy),
    behaviorTree.repeatUntilSuccess(
      'move_to_rc',
      behaviorTree.leafNode(
        'move',
        (creep) => {
          const room = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
          // If creep doesn't have a harvest room assigned, we are done
          if (!room) {
            return behaviorTree.SUCCESS;
          }

          return behaviorMovement.moveTo(creep, creep.room.controller.pos, 1, false, 25, 1500);
        },
      ),
    ),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilSuccess(
      'reserve',
      behaviorTree.leafNode(
        'claim',
        (creep, trace, kingdom) => {
          const roomId = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
          // If reserver doesn't have a room assigned, we are done
          if (!roomId) {
            return behaviorTree.SUCCESS;
          }

          // If the creep is not in the right room we are done
          if (creep.room.name !== roomId) {
            return behaviorTree.SUCCESS;
          }

          const orgRoom = kingdom.getCreepRoom(creep);

          const room = creep.room;
          if (!room) {
            trace.log('unable to get creep room');
            return behaviorTree.FAILURE;
          }

          const unowned = !room.controller || !room.controller.owner;
          const claimedByMe = room.controller && room.controller.my;
          const reservedByMe = room.controller && room.controller.reservation &&
            room.controller.reservation.username === kingdom.config.username;
          const isPrimary = orgRoom && orgRoom.isPrimary;
          const controller = room.controller;

          trace.log('reserver', {
            room: room.name,
            unowned,
            claimedByMe,
            reservedByMe,
            isPrimary,
            controller,
          });

          if (controller && controller.upgradeBlocked) {
            trace.log('upgrade/attack blocked', {ttl: room.controller.upgradeBlocked});
            return behaviorTree.FAILURE;
          }

          if (!unowned && !claimedByMe && !reservedByMe) {
            const result = creep.attackController(creep.room.controller);
            trace.log('attackController', {result});
            if (result != OK) {
              return behaviorTree.FAILURE;
            }
          } else {
            if (isPrimary) {
              const result = creep.claimController(creep.room.controller);
              trace.log('claimController', {result});
              if (result != OK) {
                return behaviorTree.FAILURE;
              }
            } else {
              const result = creep.reserveController(creep.room.controller);
              trace.log('reserveController', {result});
              if (result != OK) {
                return behaviorTree.FAILURE;
              }
            }
          }

          return behaviorTree.RUNNING;
        },
      ),
    ),
    behaviorRoom.updateSign,
  ],
);

export const roleReserver = {
  run: behaviorTree.rootNode('reserver', behaviorBoosts(behavior)),
};