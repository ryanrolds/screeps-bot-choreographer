import * as behaviorTree from "./lib.behaviortree";
import {SUCCESS, RUNNING} from "./lib.behaviortree";
import * as behaviorMovement from "./behavior.movement";

import * as MEMORY from "./constants.memory";

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
        (creep, trace, kingdom) => {
          const phase = creep.memory[BOOST_PHASE] || BOOST_PHASE_START;
          if (phase === BOOST_PHASE_DONE) {
            trace.log('boosting complete');
            return SUCCESS;
          }

          // Mark done of no requested boosts
          const desiredBoosts = creep.memory[MEMORY.DESIRED_BOOSTS] || [];
          if (!desiredBoosts.length) {
            trace.log('no requested boosts');
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          const room = kingdom.getCreepRoom(creep);
          if (!room) {
            trace.log('no room on creep');
            return SUCCESS;
          }

          const boosterPos = room.getBoosterPosition();
          if (!boosterPos) {
            trace.log('no booster position');
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          switch (phase) {
            case BOOST_PHASE_START:
              creep.memory[BOOST_PHASE] = BOOST_PHASE_MOVE;
            case BOOST_PHASE_MOVE:
              // Move to booster location
              const destination = boosterPos;

              const result = behaviorMovement.moveTo(creep, destination, 0, false, 50, 1000);
              if (result === SUCCESS) {
                creep.memory[BOOST_PHASE] = BOOST_PHASE_READY;
                return RUNNING;
              }

              return result;
            case BOOST_PHASE_READY:
              // Request boosts
              const loadedEffects = room.getLoadedEffects();
              desiredBoosts.forEach((desiredEffect) => {
                const effect = loadedEffects[desiredEffect];
                if (!effect) {
                  return;
                }

                // Find loaded compound
                const compound = effect.compounds.find((compound) => {
                  return room.getBoosterLabByResource(compound.name);
                });
                if (!compound) {
                  trace.error(`no compound for ${desiredEffect}`, {room: room.id, effect, compound});
                  return;
                }

                // Get lab for loaded compound
                const lab = room.getBoosterLabByResource(compound.name)
                if (!lab) {
                  trace.error('loaded effects out of date', {room: room.id, effect, compound})
                  return;
                }

                const result = lab.boostCreep(creep);
                trace.log('boosted', {
                  labId: lab.id,
                  compound: compound.name,
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
