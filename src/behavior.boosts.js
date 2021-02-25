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
          const phase = creep.memory[BOOST_PHASE] || BOOST_PHASE_START;

          const room = kingdom.getCreepRoom(creep);
          if (!room) {
            throw new Error(`could not get creep room: ${creep.name} ${creep.room.name}`);
          }

          const booster = room.booster;

          switch (phase) {
            case BOOST_PHASE_START:
              if (!booster) {
                // console.log('no booster in room for', creep.name, room.id);
                creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
                return SUCCESS;
              }

              // Mark done of no requested boosts
              if (!desiredBoosts.length) {
                creep.memory[BOOST_PHASE] = BOOST_PHASE_DONE;
                return SUCCESS;
              }

              // console.log('request boosts', creep.name, desiredBoosts);

              creep.memory[BOOST_PHASE] = BOOST_PHASE_MOVE;
            case BOOST_PHASE_MOVE:
              // Move to booster location
              const destination = booster.getCreepBoostPosition();

              // console.log('moving to booster', creep.name, destination);

              const result = behaviorMovement.moveTo(creep, destination, 0);
              if (result === SUCCESS) {
                creep.memory[BOOST_PHASE] = BOOST_PHASE_READY;
                return RUNNING;
              }

              return result;
            case BOOST_PHASE_READY:
              // Request boosts
              // console.log('getting boosts', creep.name, desiredBoosts);
              const loadedEffects = booster.getLoadedEffects();

              // console.log('loaded', JSON.stringify(loadedEffects));

              desiredBoosts.forEach((desiredEffect) => {
                const effect = loadedEffects[desiredEffect];
                if (!effect) {
                  return;
                }

                const compound = effect.compounds[0];
                const lab = booster.getLabByResource(compound.name);
                const result = lab.boostCreep(creep);
                trace.log(creep.id, 'boosted', {
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
