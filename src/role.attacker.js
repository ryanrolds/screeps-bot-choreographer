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
        if (x === undefined || y === undefined || !roomId) {
          trace.log('missing position memory', {x, y, roomId});
          return SUCCESS;
        }

        const position = new RoomPosition(x, y, roomId);
        trace.log('creep status', {current: creep.pos, desired: position, fatigue: creep.fatigue});

        if (creep.pos.isEqualTo(position)) {
          trace.log('creep in position', {position});
          return SUCCESS;
        }

        const ignoreCreeps = creep.pos.inRangeTo(position, 1);
        const result = creep.moveTo(position, {reusePath: 5, ignoreCreeps});
        trace.log('move to', {result, creepPos: creep.pos, position});

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'attack_heal_node',
      (creep, trace) => {
        let didHeal = false;
        const heal = creep.memory[MEMORY.MEMORY_HEAL];
        if (heal) {
          const healTarget = Game.getObjectById(heal);
          if (healTarget) {
            const healTargetDistance = creep.pos.getRangeTo(healTarget);

            if (healTarget && healTargetDistance <= 1) {
              const healResult = creep.heal(healTarget);
              trace.log('heal result', {healResult});
              didHeal = true;
            } else if (healTarget && distance <= 3) {
              const rangedHealResult = creep.rangedHeal(healTarget);
              trace.log('ranged heal result', {rangedHealResult});
              didHeal = true;
            }
          }
        }

        const attack = creep.memory[MEMORY.MEMORY_ATTACK];
        if (attack) {
          const attackTarget = Game.getObjectById(attack);
          if (attackTarget) {
            const attackDistance = creep.pos.getRangeTo(attackTarget);
            const didDismantle = false;

            if (!didHeal && attackDistance <= 1 && creep.getActiveBodyparts(WORK) > 0) {
              const dismantleResult = creep.dismantle(attackTarget);
              trace.log('dismantle result', {dismantleResult});
              didDismantle = true;
            }

            if (!didHeal && !didDismantle && attackDistance <= 1 && creep.getActiveBodyparts(ATTACK) > 0) {
              const attackResult = creep.dismantle(attackTarget);
              trace.log('attack result', {attackResult});
            }

            if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
              const rangedResult = creep.rangedMassAttack();
              trace.log('ranged mass attack result', {rangedResult});
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
