const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const behaviorRoom = require('./behavior.room');

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
          const colony = kingdom.getCreepColony(creep);
          if (!colony) {
            return FAILURE;
          }

          const primaryRoom = colony.getPrimaryRoom();
          if (!primaryRoom) {
            return FAILURE;
          }

          // Send back to primary room
          creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] = primaryRoom.id;
          delete creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];

          return SUCCESS;
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

        result = creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
        if (result === ERR_NO_BODYPART) {
          return FAILURE;
        }
        if (result === ERR_INVALID_TARGET) {
          return FAILURE;
        }
        if (result === ERR_NOT_IN_RANGE) {
          return FAILURE;
        }

        return RUNNING;
      },
    ),
    behaviorRoom.parkingLot,
  ],
);

module.exports = {
  run: behaviorTree.rootNode('defender', behavior),
};
