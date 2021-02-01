
const behaviorTree = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorMovement = require('./behavior.movement');
const {MEMORY_ASSIGN_ROOM} = require('./constants.memory');

const behaviorNonCombatant = require('./behavior.noncombatant');

const behavior = behaviorTree.selectorNode(
  'reserver_root',
  [
    behaviorTree.sequenceNode(
      'go_to_reserve_room',
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

            let destination = new RoomPosition(25, 25, room);
            const roomObject = Game.rooms[room];
            if (roomObject) {
              destination = roomObject.controller;
            }

            const result = creep.moveTo(destination);
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
              const room = creep.memory[MEMORY_ASSIGN_ROOM];
              // If creep doesn't have a harvest room assigned, we are done
              if (!room) {
                return behaviorTree.SUCCESS;
              }

              // If the creep reaches the room we are done
              if (creep.room.name !== room) {
                return behaviorTree.SUCCESS;
              }

              return behaviorMovement.moveTo(creep, creep.room.controller, 1);
            },
          ),
        ),
        behaviorCommute.setCommuteDuration,
        behaviorTree.repeatUntilSuccess(
          'reserve',
          behaviorTree.leafNode(
            'move',
            (creep, trace, kingdom) => {
              const roomId = creep.memory[MEMORY_ASSIGN_ROOM];
              // If creep doesn't have a harvest room assigned, we are done
              if (!roomId) {
                return behaviorTree.SUCCESS;
              }

              // If the creep reaches the room we are done
              if (creep.room.name !== roomId) {
                return behaviorTree.SUCCESS;
              }

              const room = kingdom.getCreepRoom(creep);
              if (!room) {
                // creep.suicide()
                return behaviorTree.FAILURE;
              }

              if (!room.unowned && !room.claimedByName && !room.reservedByMe) {
                const result = creep.attackController(creep.room.controller);
                console.log("attack result", result)
                if (result != OK) {
                  return behaviorTree.FAILURE;
                }
              } else {
                if (room.isPrimary) {
                  const result = creep.claimController(creep.room.controller);
                  if (result != OK) {
                    return behaviorTree.FAILURE;
                  }
                } else {
                  const result = creep.reserveController(creep.room.controller);
                  if (result != OK) {
                    return behaviorTree.FAILURE;
                  }
                }
              }

              return behaviorTree.RUNNING;
            },
          ),
        ),
      ],
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('reserver', behaviorNonCombatant(behavior)),
};
