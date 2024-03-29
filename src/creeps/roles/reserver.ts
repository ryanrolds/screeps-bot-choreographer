
import * as MEMORY from '../../constants/memory';
import {commonPolicy} from '../../constants/pathing_policies';
import * as behaviorCommute from '../../creeps/behavior/commute';
import {getCreepBase} from '../../os/kernel/base';
import * as behaviorTree from '../behavior/behaviortree';
import {FAILURE} from '../behavior/behaviortree';
import {behaviorBoosts} from '../behavior/boosts';
import * as behaviorMovement from '../behavior/movement';
import {updateSign} from '../behavior/room';

const behavior = behaviorTree.sequenceNode(
  'reserver_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.leafNode('set_controller_location', (creep, trace, kernel) => {
      const assignedRoom = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];

      let posStr = [25, 25, assignedRoom].join(',');

      const roomEntry = kernel.getScribe().getRoomById(assignedRoom);
      if (roomEntry?.controller?.pos) {
        const pos = roomEntry.controller?.pos;
        posStr = [pos.x, pos.y, pos.roomName].join(',');
      }

      creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = posStr;

      return behaviorTree.SUCCESS;
    }),
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 1, commonPolicy),
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

          if (!creep.room.controller) {
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
        (creep, trace, kernel) => {
          const roomId = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
          // If reserver doesn't have a room assigned, we are done
          if (!roomId) {
            trace.warn('no room assigned', {creep: creep.name});
            return behaviorTree.SUCCESS;
          }

          // If the creep is not in the right room we are done
          if (creep.room.name !== roomId) {
            trace.warn('wrong room', {creep: creep.name, room: creep.room.name, assignedRoom: roomId});
            return behaviorTree.SUCCESS;
          }

          const base = getCreepBase(kernel, creep);
          if (!base) {
            trace.error('no base config', {memory: creep.memory});
            creep.suicide();
            return FAILURE;
          }

          const room = creep.room;
          if (!room) {
            trace.info('unable to get creep room');
            return behaviorTree.FAILURE;
          }

          if (!room.controller) {
            trace.info('no controller in room');
            return behaviorTree.FAILURE;
          }

          const unowned = !room.controller?.owner && !room.controller?.reservation;
          const claimedByMe = room.controller?.my || false;
          const username = kernel.getPlanner().getUsername();
          const reservedByMe = room.controller && room.controller.reservation &&
            room.controller.reservation.username === username;
          const isPrimary = room.name === base.primary;
          const controller = room.controller;

          trace.info('reserver', {
            room: room.name,
            unowned,
            claimedByMe,
            reservedByMe,
            isPrimary,
            controller,
          });

          if (controller && controller.upgradeBlocked) {
            trace.info('upgrade/attack blocked', {ttl: room.controller.upgradeBlocked});
            return behaviorTree.FAILURE;
          }

          if (!unowned && !claimedByMe && !reservedByMe) {
            const result = creep.attackController(creep.room.controller);
            trace.info('attackController', {result});
            if (result != OK) {
              return behaviorTree.FAILURE;
            }
          } else {
            if (isPrimary) {
              const result = creep.claimController(creep.room.controller);
              trace.info('claimController', {result});
              if (result != OK) {
                return behaviorTree.FAILURE;
              }
            } else {
              const result = creep.reserveController(creep.room.controller);
              trace.info('reserveController', {result});
              if (result != OK) {
                return behaviorTree.FAILURE;
              }
            }
          }

          return behaviorTree.RUNNING;
        },
      ),
    ),
    updateSign,
  ],
);

export const roleReserver = {
  run: behaviorTree.rootNode('reserver', behaviorBoosts(behavior)),
};
