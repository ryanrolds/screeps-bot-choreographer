const behaviorTree = require('./lib.behaviortree');
const {SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');

const MEMORY = require('./constants.memory');

const BOOST_PHASE = 'boost_phase';
const BOOST_PHASE_START = 'boosting_start';
const BOOST_PHASE_MOVE = 'boosting_move';
const BOOST_PHASE_READY = 'boosting_ready';
const BOOST_PHASE_DONE = 'boosting_done';

module.exports = (behaviorNode) => {
  return behaviorTree.sequenceAlwaysNode(
    'boosting',
    [
      behaviorTree.leafNode(
        'get_boosted',
        (creep, trace, kingdom) => {
          const desiredBoosts = creep.memory[MEMORY.DESIRED_BOOSTS] || [];
          const phase = creep.memory[BOOST_PHASE] || BOOST_PHASE_MOVE;

          const room = kingdom.getCreepRoom(creep);
          if (!room) {
            return SUCCESS;
          }

          const booster = room.booster;

          if (!booster) {
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          // Mark done of no requested boosts
          if (!desiredBoosts.length) {
            creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
            return SUCCESS;
          }

          switch (phase) {
            case BOOST_PHASE_START:
              creep.memory[BOOST_PHASE] = BOOST_PHASE_MOVE;
            case BOOST_PHASE_MOVE:
              // Move to booster location
              const destination = booster.getBoostPosition();

              const result = behaviorMovement.moveTo(creep, destination, 0);
              if (result === SUCCESS) {
                creep.memory[BOOST_PHASE] = BOOST_PHASE_READY;
                return RUNNING;
              }

              return result;
            case BOOST_PHASE_READY:
              // Request boosts
              const loadedEffects = booster.getLoadedEffects();
              desiredBoosts.forEach((desiredEffect) => {
                const effect = loadedEffects[desiredEffect];
                if (!effect) {
                  return;
                }

                const compound = effect.compounds[0];
                const lab = booster.getLabByResource(compound.name);
                const result = lab.boostCreep(creep);
                trace.log('boosted', {
                  labId: lab.id,
                  compound: compound.name,
                  result,
                });
              });

              creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
              return RUNNING;
            case BOOST_PHASE_DONE:
              return SUCCESS;
            default:
              throw new Error(`Unknown boost phase: ${phase}`);
          }
        },
      ),
      behaviorNode,
    ],
  );
};
