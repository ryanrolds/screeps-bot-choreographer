import {behaviorBoosts} from '../../behavior.boosts';
import * as MEMORY from '../../constants.memory';
import * as behaviorTree from '../lib.behaviortree';

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
          trace.info('missing position memory', {x, y, roomId});
          return behaviorTree.SUCCESS;
        }

        const position = new RoomPosition(x, y, roomId);
        trace.info('creep status', {current: creep.pos, desired: position, fatigue: creep.fatigue});

        if (creep.pos.isEqualTo(position)) {
          trace.info('creep in position', {position});
          return behaviorTree.SUCCESS;
        }

        const ignoreCreeps = creep.pos.inRangeTo(position, 1);
        const result = creep.moveTo(position, {reusePath: 5, ignoreCreeps});
        trace.info('move to', {result, creepPos: creep.pos, position});

        return behaviorTree.SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'attack_heal_node',
      (creep, trace) => {
        let didHeal = false;
        const heal = creep.memory[MEMORY.MEMORY_HEAL] as Id<Creep>;
        if (heal) {
          const healTarget = Game.getObjectById(heal);
          if (healTarget) {
            const healTargetDistance = creep.pos.getRangeTo(healTarget);

            if (healTarget && healTargetDistance <= 1) {
              const healResult = creep.heal(healTarget);
              trace.info('heal result', {healResult});
              didHeal = true;
            } else if (healTarget && healTargetDistance <= 3) {
              const rangedHealResult = creep.rangedHeal(healTarget);
              trace.info('ranged heal result', {rangedHealResult});
              didHeal = true;
            }
          }
        }

        const attack = creep.memory[MEMORY.MEMORY_ATTACK];
        if (attack) {
          const attackTarget = Game.getObjectById(attack as Id<Structure>);
          if (attackTarget) {
            const attackDistance = creep.pos.getRangeTo(attackTarget);
            let didDismantle = false;

            if (!didHeal && attackDistance <= 1 && creep.getActiveBodyparts(WORK) > 0) {
              const dismantleResult = creep.dismantle(attackTarget);
              trace.info('dismantle result', {dismantleResult});
              didDismantle = true;
            }

            if (!didHeal && !didDismantle && attackDistance <= 1 && creep.getActiveBodyparts(ATTACK) > 0) {
              const attackResult = creep.attack(attackTarget);
              trace.info('attack result', {attackResult});
            }

            if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
              const rangedResult = creep.rangedAttack(attackTarget);
              trace.info('ranged attack result', {rangedResult});
            }
          }
        }

        return behaviorTree.SUCCESS;
      },
    ),
  ],
);

export const roleAttacker = {
  run: behaviorTree.rootNode('attacker', behaviorBoosts(behavior)),
};
