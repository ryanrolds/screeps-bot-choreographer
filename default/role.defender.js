const behaviorTree = require('lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree');
const behaviorAssign = require('behavior.assign');

const behavior = behaviorTree.sequenceNode(
  'defender_root',
  [
    behaviorAssign.moveToRoom,
    behaviorTree.leafNode(
      'attack_hostiles',
      (creep) => {
        let hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (!hostile) {
          const invaderCores = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
              return structure.structureType === STRUCTURE_INVADER_CORE;
            },
          });

          if (!invaderCores.length) {
            return SUCCESS;
          }

          hostile = invaderCores[0];
        }

        console.log('hostile', creep.name, hostile);

        const inRange = creep.pos.getRangeTo(hostile) <= 3;
        if (inRange) {
          const result = creep.rangedAttack(hostile);
          console.log('attack', creep.name, result);
        }

        console.log('inRange', creep.name, inRange);

        const pathToHostile = creep.pos.findPathTo(hostile);
        const lastRampart = pathToHostile.reduce((lastRampart, pos) => {
          pos = creep.room.getPositionAt(pos.x, pos.y);
          const posStructures = pos.lookFor(LOOK_STRUCTURES);
          const hasRampart = _.filter(posStructures, (structure) => {
            return structure.structureType === STRUCTURE_RAMPART;
          });

          const hasCreep = pos.lookFor(LOOK_CREEPS).length > 0;

          console.log('structures', creep.name, posStructures, hasRampart, hasCreep);

          if (hasRampart && !hasCreep) {
            lastRampart = pos;
          }

          return lastRampart;
        }, null);

        console.log('last rampart', creep.name, JSON.stringify(lastRampart));

        if (lastRampart) {
          creep.moveTo(lastRampart, {visualizePathStyle: {stroke: '#ffffff'}});
          return RUNNING;
        }

        const creepPosStructures = creep.pos.lookFor(LOOK_STRUCTURES);
        const inRampart = _.filter(creepPosStructures, (structure) => {
          return structure.structureType === STRUCTURE_RAMPART;
        }).length > 0;

        console.log('in rampart', creep.name, inRampart);

        if (inRampart) {
          return RUNNING;
        }

        result = creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
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
  ],
);

module.exports = {
  run: (creep, trace) => {
    const roleTrace = trace.begin('defender');

    const result = behavior.tick(creep, roleTrace);
    if (result == behaviorTree.FAILURE) {
      console.log('INVESTIGATE: defender failure', creep.name);
    }

    roleTrace.end();
  },
};
