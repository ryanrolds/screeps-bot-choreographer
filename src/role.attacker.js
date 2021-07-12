const behaviorTree = require('./lib.behaviortree');
const {SUCCESS} = require('./lib.behaviortree');
const behaviorBoosts = require('./behavior.boosts');

const MEMORY = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'attacker_root',
  [
    behaviorTree.leafNode(
      'move_node',
      (creep, trace) => {
        const x = _.min([_.max([creep.memory[MEMORY.MEMORY_POSITION_X], 0]), 49]);
        const y = _.min([_.max([creep.memory[MEMORY.MEMORY_POSITION_Y], 0]), 49]);
        const roomId = creep.memory[MEMORY.MEMORY_POSITION_ROOM];
        if (!x || !y || !roomId) {
          return SUCCESS;
        }

        const position = new RoomPosition(x, y, roomId);

        if (creep.pos.isEqualTo(position)) {
          return SUCCESS;
        }

        const ignoreCreeps = creep.pos.inRangeTo(position, 1);
        if (creep.room.name != roomId) {
          creep.moveTo(position, {reusePath: 5, ignoreCreeps});
        } else {
          creep.moveTo(position, {reusePath: 5, ignoreCreeps});
        }

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'attack_heal_node',
      (creep) => {
        const didAttack = false;
        const attack = creep.memory[MEMORY.MEMORY_ATTACK];
        if (attack) {
          const attackTarget = Game.getObjectById(attack);
          if (attackTarget && creep.pos.inRangeTo(attackTarget, 1)) {
            didAttack = true;
            creep.attack(attackTarget);
          }
        }

        const heal = creep.memory[MEMORY.MEMORY_HEAL];
        if (heal) {
          const healTarget = Game.getObjectById(heal);
          if (healTarget && creep.pos.inRangeTo(healTarget, 3)) {
            if (didAttack) {
              creep.rangedHeal(healTarget);
            } else {
              creep.heal(healTarget);
            }
          }
        }

        return SUCCESS;
      },
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('attacker', behaviorBoosts(behavior)),
};
