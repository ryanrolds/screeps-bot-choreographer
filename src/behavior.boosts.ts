import {getBoostPosition, getCreepBase, getLabsForAction} from './base';
import * as behaviorMovement from './behavior.movement';
import * as MEMORY from './constants.memory';
import {Kernel} from './kernel';
import * as behaviorTree from './lib.behaviortree';
import {RUNNING, SUCCESS} from './lib.behaviortree';

const BOOST_PHASE = 'boost_phase';
const BOOST_PHASE_START = 'boosting_start';
const BOOST_PHASE_MOVE = 'boosting_move';
const BOOST_PHASE_READY = 'boosting_ready';
const BOOST_PHASE_DONE = 'boosting_done';

export const behaviorBoosts = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'boosting',
    [
      behaviorTree.leafNode(
        'get_boosted',
        (creep, trace, kernel: Kernel) => {
          const phase = creep.memory[BOOST_PHASE] || BOOST_PHASE_START;
          if (phase === BOOST_PHASE_DONE) {
            trace.info('boosting complete');
            return SUCCESS;
          }

          // Mark done of no requested boosts
          const desiredActions = creep.memory[MEMORY.DESIRED_BOOSTS] || [];
          if (!desiredActions.length) {
            trace.info('no requested action boosts');
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          const base = getCreepBase(kernel, creep);
          if (!base) {
            trace.error('no base config', {creep: creep.name});
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          const boosterPos = getBoostPosition(base);
          if (!boosterPos) {
            trace.info('no booster position');
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          switch (phase) {
            case BOOST_PHASE_START:
              // eslint-disable-next-line no-fallthrough
              creep.memory[BOOST_PHASE] = BOOST_PHASE_MOVE;
            // eslint-disable-next-line no-fallthrough
            case BOOST_PHASE_MOVE: {
              // Move to booster location
              const result = behaviorMovement.moveTo(creep, boosterPos, 0, false, 50, 1000);
              if (result === SUCCESS) {
                creep.memory[BOOST_PHASE] = BOOST_PHASE_READY;
                return RUNNING;
              }

              return result;
            }
            case BOOST_PHASE_READY:
              desiredActions.forEach((desiredAction) => {
                const labs = getLabsForAction(base, desiredAction);
                if (!labs.length) {
                  trace.info('no labs for action', {action: desiredAction});
                  return;
                }

                const lab = labs[0];

                const result = lab.boostCreep(creep);
                trace.info('boosted', {
                  labId: lab.id,
                  compound: lab.mineralType,
                  result,
                });
              });

              creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
              return RUNNING;
            default:
              throw new Error(`Unknown boost phase: ${phase}`);
          }
        },
      ),
      behaviorNode,
    ],
  );
};
