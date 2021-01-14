const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');

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

        const inRange = creep.pos.getRangeTo(hostile) <= 3;
        if (inRange) {
          const result = creep.rangedAttack(hostile);
        }

        const pathToHostile = creep.pos.findPathTo(hostile);
        const lastRampart = pathToHostile.reduce((lastRampart, pos) => {
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
  id: 'defender',
  run: behaviorTree.rootNode(this.id, behavior).tick
};
