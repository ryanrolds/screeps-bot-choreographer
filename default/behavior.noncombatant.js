const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const behaviorMovement = require('behavior.movement')


module.exports = (behaviorNode) => {
    return behaviorTree.SequenceAlwaysNode(
        'non_combatant',
        [
            behaviorTree.LeafNode(
                'flee_hostiles',
                (creep, trace, kingdom) => {
                    const room = kingdom.getCreepRoom(creep)
                    if (!room) {
                        return SUCCESS
                    }

                    const colony = kingdom.getCreepColony(creep)
                    if (!colony) {
                        return SUCCESS
                    }
                    if (!colony.primaryRoom) {
                        return SUCCESS
                    }


                    if (!room.numHostiles || creep.room.name === colony.primaryRoom.name) {
                        return SUCCESS
                    }

                    if (creep.room.name !== colony.primaryRoom.name) {
                        let result = creep.moveTo(new RoomPosition(25, 25, colony.primaryRoom.name))
                        if (result === ERR_NO_PATH) {
                            return FAILURE
                        }

                        if (result === ERR_INVALID_ARGS) {
                            return FAILURE
                        }

                        return RUNNING
                    }

                    return behaviorMovement.moveTo(creep, colony.primaryRoom.controller, 1)

                }
            ),
            behaviorNode
        ]
    )
}