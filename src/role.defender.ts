import * as behaviorTree from './lib.behaviortree';
import {FAILURE, SUCCESS, RUNNING} from './lib.behaviortree';
import * as behaviorAssign from './behavior.assign';
import {behaviorBoosts} from './behavior.boosts';
import {roadWorker} from './behavior.logistics';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';

const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');

const behavior = behaviorTree.sequenceNode(
  'defender_root',
  [
    behaviorAssign.moveToRoom,
    behaviorTree.leafNode(
      'attack_hostiles',
      (creep: Creep, trace: Tracer, kingdom: Kingdom) => {
        const room = kingdom.getCreepRoom(creep);
        if (!room) {
          trace.log('creep has no room', creep.memory);
          return FAILURE;
        }

        if (creep.hits < creep.hitsMax) {
          const result = creep.heal(creep);
          trace.log('healing self', {result});
        }

        // Get targets in the room
        const roomId = room.id;
        const targets = room.getColony().getFilteredRequests(TOPICS.PRIORITY_TARGETS,
          (target) => {
            return target.details.roomName === roomId;
          },
        ).reverse();

        /*
        // If there are no priority targets, start destroying whatever is there
        if (targets.length === 0) {
          targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3);

          targets = targets.concat(creep.room.find(FIND_HOSTILE_STRUCTURES, {
            filter: (structure) => {
              return structure.structureType === STRUCTURE_TOWER ||
                structure.structureType === STRUCTURE_SPAWN;
            },
          }));

          targets = targets.concat(creep.room.find(FIND_HOSTILE_STRUCTURES, {
            filter: (structure) => {
              return structure.structureType === STRUCTURE_RAMPART ||
                structure.structureType === STRUCTURE_WALL;
            },
          }));
        }
        */

        trace.log('room targets', {targets});

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

        trace.log('target', {moveTarget, attackTarget});

        if (attackTarget) {
          const result = creep.rangedAttack(attackTarget);
          trace.log('ranged attack result', {result, targetId: attackTarget.id});
        }

        // TODO defender should keep distance unless in rampart
        // TODO defender should flee and heal if low on hits

        if (!moveTarget) {
          return moveToAssignedPosition(creep, trace, kingdom);
        }

        // TODO should not check this often
        const pathToTarget = creep.pos.findPathTo(moveTarget, {range: 3});

        const lastRampart = pathToTarget.reduce((lastRampart, pos): RoomPosition => {
          const roomPos = creep.room.getPositionAt(pos.x, pos.y);
          const posStructures = roomPos.lookFor(LOOK_STRUCTURES);
          const hasRampart = _.filter(posStructures, (structure) => {
            return structure.structureType === STRUCTURE_RAMPART;
          });

          const hasCreep = roomPos.lookFor(LOOK_CREEPS).length > 0;

          if (hasRampart && !hasCreep) {
            lastRampart = roomPos;
          }

          return lastRampart;
        }, null as RoomPosition);

        trace.log('last rampart', {lastRampart});

        if (lastRampart) {
          const creepPosStructures = creep.pos.lookFor(LOOK_STRUCTURES);
          const inLastRampart = _.filter(creepPosStructures, (structure) => {
            return structure.id === structure.id;
          }).length > 0;

          if (inLastRampart) {
            trace.log('in rampart');
            // return RUNNING;
          }

          const result = creep.moveTo(lastRampart, {visualizePathStyle: {stroke: '#ffffff'}});
          trace.log('moving to last rampart', {result});
          // return RUNNING;
        }

        if (creep.pos.getRangeTo(moveTarget) <= 2) {
          trace.log('target in range');
          return RUNNING;
        }

        const result = move(creep, moveTarget, 2);
        trace.log('move to target', {result, moveTarget});

        return RUNNING;
      },
    ),
  ],
);

const moveToAssignedPosition = (creep: Creep, trace: Tracer, kingdom: Kingdom) => {
  let position: RoomPosition = null;

  // Check if creep knows last known position
  const positionString = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] || null;
  if (positionString) {
    const posArray = positionString.split(',');
    if (posArray && posArray.length === 3) {
      position = new RoomPosition(posArray[0], posArray[1], posArray[2]);
    } else {
      trace.log('invalid position string', {positionString});
    }
  } else {
    trace.log('failed to get position string');
  }

  // If don't have a last known position, go to parking lot
  if (!position) {
    const baseConfig = kingdom.getCreepBaseConfig(creep);
    if (baseConfig) {
      position = baseConfig.parking;
    } else {
      trace.log('could not get creep base config');
    }
  }

  if (!position) {
    trace.log('not able to determine destination, failing');
    return FAILURE;
  }

  // Check if we are at the destination
  if (creep.pos.getRangeTo(position) < 1) {
    trace.log('reached last known position or parking lot, waiting...');
    return SUCCESS;
  }

  // Move to destination
  const result = move(creep, position, 1);
  trace.log('move to last known hostile position or parking lot', {result, position});

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
  run: behaviorTree.rootNode('defender', behaviorBoosts(roadWorker(behavior))),
};
