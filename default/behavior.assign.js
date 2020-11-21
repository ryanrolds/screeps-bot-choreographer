const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const { MEMORY_ASSIGN_ROOM } = require('constants.memory')

const moveToRoom = behaviorTree.RepeatUntilSuccess(
    'bt.assign.moveToAssignedRoom',
    behaviorTree.LeafNode(
        'move_to_exit',
        (creep) => {
            const roomID = creep.memory[MEMORY_ASSIGN_ROOM]
            if (!roomID) {
                return SUCCESS
            }

            if (creep.room.name === roomID) {
                return SUCCESS
            }

            const exitDir = creep.room.findExitTo(roomID)
            if (exitDir === ERR_INVALID_ARGS) {
                return SUCCESS
            }

            // TODO cache the path
            const exit = creep.pos.findClosestByRange(exitDir);
            const result = creep.moveTo(exit);
            if (result === ERR_INVALID_ARGS) {
                return FAILURE
            }

            return RUNNING
        }
    )
)

const clearRoom = (creep) => {
    delete creep.memory[MEMORY_ASSIGN_ROOM]
}

module.exports = {
    moveToRoom,
    clearRoom
}
