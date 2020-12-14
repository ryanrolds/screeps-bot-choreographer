const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const MEMORY = require('constants.memory')

module.exports.setCommuteDuration = behaviorTree.LeafNode(
    'bt.harvest.setCommuteDuration',
    (creep) => {
        const startTick = creep.memory[MEMORY.MEMORY_START_TICK]
        // Only set commute if we have a start tick and if we have not already set the commute time
        if (startTick && !creep.memory[MEMORY.MEMORY_COMMUTE_DURATION]) {
            const commuteTime = Game.time - startTick
            creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] = commuteTime
        }

        return SUCCESS
    }
)
