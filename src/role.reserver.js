
const behaviorTree = require('./lib.behaviortree');
const {FAILURE} = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorMovement = require('./behavior.movement');
const behaviorNonCombatant = require('./behavior.noncombatant');
const MEMORY = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'reserver_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.leafNode(
      'move_to_room',
      (creep, trace, kingdom) => {
        const room = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
        if (!room) {
          return FAILURE;
        }

        // If the creep reaches the room we are done
        if (creep.room.name === room) {
          return behaviorTree.SUCCESS;
        }

        // Move to center of the room or controller
        let destination = new RoomPosition(25, 25, room);
        const roomObject = Game.rooms[room];
        if (roomObject) {
          destination = roomObject.controller;
        }

        const result = creep.moveTo(destination, {
          reusePath: 50,
          maxOps: 1500,
        });

        // console.log(creep.name, "moveTo result", result)

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
          const room = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
          // If creep doesn't have a harvest room assigned, we are done
          if (!room) {
            return behaviorTree.SUCCESS;
          }

          // If the creep reaches the room we are done
          if (creep.room.name !== room) {
            return behaviorTree.SUCCESS;
          }

          return behaviorMovement.moveTo(creep, creep.room.controller, 1, false, 25, 1000);
        },
      ),
    ),
    behaviorCommute.setCommuteDuration,
    behaviorTree.repeatUntilSuccess(
      'reserve',
      behaviorTree.leafNode(
        'claim',
        (creep, trace, kingdom) => {
          const roomId = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
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
            trace.log('unable to get creep room', {result});
            return behaviorTree.FAILURE;
          }

          if (!room.unowned && !room.claimedByMe && !room.reservedByMe) {
            const result = creep.attackController(creep.room.controller);
            trace.log('attackController', {result});
            if (result != OK) {
              return behaviorTree.FAILURE;
            }
          } else {
            if (room.isPrimary) {
              const result = creep.claimController(creep.room.controller);
              trace.log('claimController', {result});
              if (result != OK) {
                return behaviorTree.FAILURE;
              }
            } else {
              const result = creep.reserveController(creep.room.controller);
              trace.log('reserveController', {result});
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
);

module.exports = {
  run: behaviorTree.rootNode('reserver', behaviorNonCombatant(behavior)),
};
