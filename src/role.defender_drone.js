const behaviorTree = require('./lib.behaviortree');
const {SUCCESS} = require('./lib.behaviortree');
const behaviorBoosts = require('./behavior.boosts');

const MEMORY = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'defender_drone_root',
  [
    behaviorTree.leafNode(
      'move_node',
      (creep, trace) => {
        const x = creep.memory[MEMORY.MEMORY_POSITION_X];
        const y = creep.memory[MEMORY.MEMORY_POSITION_Y];
        const roomId = creep.memory[MEMORY.MEMORY_POSITION_ROOM];
        if (!x || !y || !roomId) {
          trace.log('missing position data', {x, y, roomId});
          return SUCCESS;
        }

        const position = new RoomPosition(x, y, roomId);

        if (creep.pos.isEqualTo(position)) {
          trace.log('creep at position', {position});
          return SUCCESS;
        }

        let result = null;
        if (creep.room.name != roomId) {
          result = creep.moveTo(position, {reusePath: 50, visualizePathStyle: {stroke: '#ffffff'}});
        } else {
          let ignoreCreep = false;
          if (creep.memory[MEMORY.MEMORY_DEFENSE_IN_POSITION]) {
            ignoreCreep = true;
          }
          result = creep.moveTo(position, {reusePath: 5, ignoreCreep, visualizePathStyle: {stroke: '#ffffff'}});
        }

        trace.log('move to', {result, position});

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'attack_node',
      (creep, trace) => {
        const attack = creep.memory[MEMORY.MEMORY_ATTACK];
        if (!attack) {
          trace.log('no attack target');
          return SUCCESS;
        }

        const target = Game.getObjectById(attack);
        if (!target) {
          trace.log('target gone, did it die?', {attack});
          return SUCCESS;
        }

        if (!creep.pos.inRangeTo(target, 3)) {
          trace.log('target not in range attack range', {target});
          return SUCCESS;
        }

        const result = creep.rangedAttack(target);
        trace.log('range attack', {result, target});

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'heal_node',
      (creep, trace) => {
        const heal = creep.memory[MEMORY.MEMORY_HEAL];
        if (!heal) {
          trace.log('no heal target');
          return SUCCESS;
        }

        const target = Game.getObjectById(heal);
        if (!creep.pos.inRangeTo(target, 1)) {
          trace.log('target not in heal range', {target});
          return SUCCESS;
        }

        const result = creep.heal(target);
        trace.log('heal', {result, target});

        return SUCCESS;
      },
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('defender_drone', behaviorBoosts(behavior)),
};
