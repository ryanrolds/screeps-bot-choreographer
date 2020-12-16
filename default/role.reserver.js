
const behaviorTree = require('lib.behaviortree')
const behaviorCommute = require('behavior.commute')
const behaviorMovement = require('behavior.movement')
const { MEMORY_ASSIGN_ROOM } = require('constants.memory')

const behaviorNonCombatant = require('behavior.noncombatant')

const behavior = behaviorTree.SelectorNode(
    "reserver_root",
    [
        behaviorTree.SequenceNode(
            'go_to_reserve_room',
            [
                behaviorTree.LeafNode(
                    'move_to_room',
                    (creep) => {
                        const room = creep.memory[MEMORY_ASSIGN_ROOM]
                        // If creep doesn't have a harvest room assigned, we are done
                        if (!room) {
                            return behaviorTree.SUCCESS
                        }

                        // If the creep reaches the room we are done
                        if (creep.room.name === room) {
                            return behaviorTree.SUCCESS
                        }

                        let result = creep.moveTo(new RoomPosition(25, 25, room));
                        if (result === ERR_NO_PATH) {
                            return behaviorTree.FAILURE
                        }

                        if (result === ERR_INVALID_ARGS) {
                            return behaviorTree.FAILURE
                        }

                        return behaviorTree.RUNNING
                    }
                ),
                behaviorTree.RepeatUntilSuccess(
                    'move_to_rc',
                    behaviorTree.LeafNode(
                        'move',
                        (creep) => {
                            return behaviorMovement.moveTo(creep, creep.room.controller, 1)
                        }
                    )
                ),
                behaviorCommute.setCommuteDuration,
                behaviorTree.RepeatUntilSuccess(
                    'reserve',
                    behaviorTree.LeafNode(
                        'move',
                        (creep) => {
                            let result = creep.reserveController(creep.room.controller)
                            if (result != OK) {
                                return behaviorTree.FAILURE
                            }

                            return behaviorTree.RUNNING
                        }
                    )
                )
            ]
        )
    ]
)

module.exports = {
    run: (creep, trace, kingdom) => {
        const roleTrace = trace.begin('reserver')

        let result = behaviorNonCombatant(behavior).tick(creep, roleTrace, kingdom)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: reserver failure", creep.name)
        }

        roleTrace.end()
    }
}
