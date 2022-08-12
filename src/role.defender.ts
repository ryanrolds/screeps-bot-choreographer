import {getCreepBase} from './base';
import * as behaviorAssign from './behavior.assign';
import {behaviorBoosts} from './behavior.boosts';
import {MEMORY_ASSIGN_ROOM_POS} from './constants.memory';
import {Kernel} from './kernel';
import * as behaviorTree from './lib.behaviortree';
import {FAILURE, RUNNING, SUCCESS} from './lib.behaviortree';
import {Tracer} from './lib.tracing';
import {getBasePriorityTargetsTopic} from './runnable.manager.defense';

const behavior = behaviorTree.sequenceNode(
  'defender_root',
  [
    behaviorAssign.moveToRoom,
    behaviorTree.leafNode(
      'attack_hostiles',
      (creep: Creep, trace: Tracer, kernel: Kernel) => {
        const base = getCreepBase(kernel, creep);
        if (!base) {
          trace.error('creep has no base', {memory: creep.memory});
        }

        // Heal self or adjacent creep if one has lower HP
        let healTarget = null;
        if (creep.hits < creep.hitsMax) {
          healTarget = creep;
        }

        // heal adjacent creeps with lowest HP
        let friendlyCreepsNearby = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
          filter: (c: Creep) => c.hits < c.hitsMax,
        });
        friendlyCreepsNearby = _.sortBy(friendlyCreepsNearby, (a) => {
          return a.hits / a.hitsMax;
        });

        const first = friendlyCreepsNearby[0];
        if (first && (!healTarget || first.hits < healTarget.hits)) {
          healTarget = first;
        }

        // if we have a heal target, heal it
        if (healTarget) {
          const result = creep.heal(healTarget);
          trace.info('healing self', {result});
        }

        // Get targets in the room
        const roomId = creep.room.name;
        const targets = kernel.getTopics().getFilteredRequests(getBasePriorityTargetsTopic(base.id),
          (target) => {
            return target.details.roomName === roomId;
          },
        );

        trace.info('room targets', {targets});

        // We move to the room target and attack the highest priority target in range,
        // which could also be the room target or a target of opportunity
        let moveTarget = null;
        let attackTarget = null;

        if (targets.length) {
          moveTarget = Game.getObjectById(targets[0].details.id);

          const inRangeHostiles = _.find(targets, (target) => {
            const hostile = Game.getObjectById<Id<Creep>>(target.details.id);
            return hostile && creep.pos.inRangeTo(hostile, 3);
          });
          if (inRangeHostiles) {
            attackTarget = Game.getObjectById(inRangeHostiles.details.id);
          }
        }

        trace.info('target', {moveTarget, attackTarget});

        if (attackTarget) {
          const result = creep.rangedAttack(attackTarget);
          trace.info('ranged attack result', {result, targetId: attackTarget.id});
        }

        // If not in rampart, move to target
        if (!moveTarget) {
          return moveToAssignedPosition(creep, trace, kernel);
        }

        // If we are less then 2/3 health, move back and heal
        if (creep.hits < creep.hitsMax * 0.666) {
          trace.info('too damaged, flee');
          const base = getCreepBase(kernel, creep);
          if (base) {
            const result = creep.moveTo(base.origin);
            trace.info('moving to base origin to heal', {result});
            return RUNNING;
          }
        }

        if (creep.pos.getRangeTo(moveTarget) <= 3) {
          trace.info('target in range');
          return RUNNING;
        }

        const result = move(creep, moveTarget, 3);
        trace.info('move to target', {result, moveTarget});

        return RUNNING;
      },
    ),
  ],
);

const moveToAssignedPosition = (creep: Creep, trace: Tracer, kernel: Kernel) => {
  let position: RoomPosition = null;

  // Check if creep knows last known position
  const positionString = creep.memory[MEMORY_ASSIGN_ROOM_POS] || null;
  if (positionString) {
    const posArray = positionString.split(',');
    if (posArray && posArray.length === 3) {
      position = new RoomPosition(posArray[0], posArray[1], posArray[2]);
    } else {
      trace.info('invalid position string', {positionString});
    }
  } else {
    trace.info('failed to get position string');
  }

  // If don't have a last known position, go to parking lot
  if (!position) {
    const base = getCreepBase(kernel, creep);
    if (base) {
      position = base.parking;
    } else {
      trace.info('could not get creep base config');
    }
  }

  if (!position) {
    trace.info('not able to determine destination, failing');
    return FAILURE;
  }

  // Check if we are at the destination
  if (creep.pos.getRangeTo(position) < 1) {
    trace.info('reached last known position or parking lot, waiting...');
    return SUCCESS;
  }

  // Move to destination
  const result = move(creep, position, 1);
  trace.info('move to last known hostile position or parking lot', {result, position});

  return RUNNING;
};

const move = (creep: Creep, target: RoomPosition, range = 3) => {
  const result = creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, range});
  if (result === ERR_NO_BODYPART) {
    return FAILURE;
  }

  if (result === ERR_INVALID_TARGET) {
    return FAILURE;
  }

  return SUCCESS;
};

export const roleDefender = {
  run: behaviorTree.rootNode('defender', behaviorBoosts(behavior)),
};
