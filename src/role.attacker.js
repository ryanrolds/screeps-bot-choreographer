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
          creep.moveTo(position, {reusePath: 50, ignoreCreeps});
        } else {
          creep.moveTo(position, {reusePath: 5, ignoreCreeps});
        }

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'attack_node',
      (creep) => {
        const attack = creep.memory[MEMORY.MEMORY_ATTACK];
        if (!attack) {
          return SUCCESS;
        }

        const target = Game.getObjectById(attack);
        if (!creep.pos.inRangeTo(target, 1)) {
          return SUCCESS;
        }

        creep.attack(target);

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'heal_node',
      (creep) => {
        const heal = creep.memory[MEMORY.MEMORY_HEAL];
        if (!heal) {
          return SUCCESS;
        }

        const target = Game.getObjectById(heal);
        if (!creep.pos.inRangeTo(target, 1)) {
          return SUCCESS;
        }

        creep.heal(target);

        return SUCCESS;
      },
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('attacker', behaviorBoosts(behavior)),
};
