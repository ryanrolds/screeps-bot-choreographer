
const behaviorTree = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorMovement = require('./behavior.movement');
const {MEMORY_ASSIGN_ROOM} = require('./constants.memory');
const behaviorNonCombatant = require('./behavior.noncombatant');

const behavior = behaviorTree.selectorNode(
  'claimer_root',
  [
    behaviorTree.sequenceNode(
      'go_to_claim_room',
      [
        behaviorTree.leafNode(
          'move_to_room',
          (creep) => {
            const room = creep.memory[MEMORY_ASSIGN_ROOM];
            // If creep doesn't have a harvest room assigned, we are done
            if (!room) {
              return behaviorTree.SUCCESS;
            }

            // If the creep reaches the room we are done
            if (creep.room.name === room) {
              return behaviorTree.SUCCESS;
            }

            const result = creep.moveTo(new RoomPosition(25, 25, room));
            if (result === ERR_NO_PATH) {
              return behaviorTree.FAILURE;
            }

            if (result === ERR_INVALID_ARGS) {
              return behaviorTree.FAILURE;
            }

            return behaviorTree.RUNNING;
          },
        ),
        behaviorTree.repeatUntilSuccess(
          'move_to_rc',
          behaviorTree.leafNode(
            'move',
            (creep) => {
              return behaviorMovement.moveTo(creep, creep.room.controller, 1);
            },
          ),
        ),
        behaviorCommute.setCommuteDuration,
        behaviorTree.repeatUntilSuccess(
          'reserve',
          behaviorTree.leafNode(
            'move',
            (creep) => {
              const result = creep.claimController(creep.room.controller);

              if (result === ERR_GCL_NOT_ENOUGH) {
                creep.reserveController(creep.room.controller);
              }

              return behaviorTree.FAILURE;
            },
          ),
        ),
      ],
    ),
  ],
);

module.exports = {
  id: 'claimer',
  run: behaviorTree.rootNode(this.id, behaviorNonCombatant(behavior)).tick
};
