const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const behaviorBoosts = require('./behavior.boosts');

const MEMORY = require('./constants.memory');

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

        let target = null;

        // TODO check this one at a time
        const hostiles = room.getHostiles();
        const invaderCores = room.getInvaderCores();
        const hostileStructures = room.getHostileStructures();
        if (hostiles.length) {
          hostiles = _.sortBy(hostiles, (hostile) => {
            return creep.pos.getRangeTo(hostile);
          });

          target = Game.getObjectById(hostiles[0].id);
        } else if (invaderCores.length) {
          target = invaderCores[0];
        } else if (hostileStructures.length) {
          target = hostileStructures[0];
        } else {
          const positionString = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] || null;
          if (!positionString) {
            trace.log('failed to get position string');
            return FAILURE;
          }

          const position = null;
          const posArray = positionString.split(',');
          if (posArray && posArray.length === 3) {
            position = new RoomPosition(posArray[0], posArray[1], posArray[2]);
          }

          if (!position) {
            trace.log('no or invalid position string', {positionString, posArray});
            return FAILURE;
          }

          if (creep.pos.getRangeTo(position) < 3) {
            trace.log('reached last known position, waiting...');
            return SUCCESS;
          }

          const result = move(creep, position);
          trace.log('move to last known hostile position', {result, position});

          return RUNNING;
        }

        if (creep.pos.getRangeTo(target) <= 3) {
          const result = creep.rangedAttack(target);
          trace.log('ranged attack result', {result});
        }

        if (creep.pos.getRangeTo(target) === 1) {
          return RUNNING;
        }

        const pathToTarget = creep.pos.findPathTo(target);
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

        const result = move(creep, target);
        trace.log('move to target', {result});

        return RUNNING;
      },
    ),
  ],
);

const move = (creep, target) => {
  result = creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}, range: 3});
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
