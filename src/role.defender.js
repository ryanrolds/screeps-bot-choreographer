const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const behaviorBoosts = require('./behavior.boosts');

const MEMORY = require('./constants.memory');
const TOPICS = require('./constants.topics');

const behavior = behaviorTree.sequenceNode(
  'defender_root',
  [
    behaviorAssign.moveToRoom,
    behaviorTree.leafNode(
      'attack_hostiles',
      (creep, trace, kingdom) => {
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

        trace.log('room targets', {targets});

        // We move to the room target and attack the highest priority target in range,
        // which could also be the room target or a target of opportunity
        let moveTarget = null;
        let attackTarget = null;

        if (targets.length) {
          moveTarget = Game.getObjectById(targets[0].details.id);

          const inRangeHostiles = _.find(targets, (target) => {
            const hostile = Game.getObjectById(target.details.id);
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

        if (creep.pos.getRangeTo(moveTarget) <= 2) {
          trace.log('target in range');
          return RUNNING;
        }

        const pathToTarget = creep.pos.findPathTo(moveTarget);
        const lastRampart = pathToTarget.reduce((lastRampart, pos) => {
          pos = creep.room.getPositionAt(pos.x, pos.y);
          const posStructures = pos.lookFor(LOOK_STRUCTURES);
          const hasRampart = _.filter(posStructures, (structure) => {
            return structure.structureType === STRUCTURE_RAMPART;
          });

          const hasCreep = pos.lookFor(LOOK_CREEPS).length > 0;

          if (hasRampart && !hasCreep) {
            lastRampart = pos;
          }

          return lastRampart;
        }, null);

        if (lastRampart) {
          creep.moveTo(lastRampart, {visualizePathStyle: {stroke: '#ffffff'}});
          return RUNNING;
        }

        const creepPosStructures = creep.pos.lookFor(LOOK_STRUCTURES);
        const inRampart = _.filter(creepPosStructures, (structure) => {
          return structure.structureType === STRUCTURE_RAMPART;
        }).length > 0;

        if (inRampart) {
          return RUNNING;
        }

        const result = move(creep, moveTarget, 3);
        trace.log('move to target', {result, moveTarget});

        return RUNNING;
      },
    ),
  ],
);

const moveToAssignedPosition = (creep, trace, kingdom) => {
  let position = null;

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
    const colony = kingdom.getCreepColony(creep);
    if (colony) {
      const room = colony.getPrimaryRoom();
      if (room) {
        const parkingLot = room.getParkingLot();
        if (parkingLot) {
          trace.log('going to parking lot', {pos: parkingLot.pos});
          position = parkingLot.pos;
        } else {
          trace.log('could not find parking lot in primary room');
        }
      } else {
        trace.log('could not get colony primary room');
      }
    } else {
      trace.log('could not get creep colony');
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

const move = (creep, target, range = 3) => {
  result = creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, range});
  if (result === ERR_NO_BODYPART) {
    return FAILURE;
  }
  if (result === ERR_INVALID_TARGET) {
    return FAILURE;
  }
  if (result === ERR_NOT_IN_RANGE) {
    return FAILURE;
  }

  return SUCCESS;
};

module.exports = {
  run: behaviorTree.rootNode('defender', behaviorBoosts(behavior)),
};
