const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const { MEMORY_FLAG } = require('constants.memory')

const moveToFlag = module.exports.moveToFlag = behaviorTree.SequenceNode(
    'move_to_flag',
    [
        behaviorTree.LeafNode(
            'move_to_flag_leaf',
            (creep) => {
                const flagID = creep.memory[MEMORY_FLAG]
                if (!flagID) {
                    return FAILURE
                }

                const flag = Game.flags[flagID]
                if (!flag) {
                    return FAILURE
                }

                if (creep.pos.inRangeTo(flag, 3)) {
                    return SUCCESS
                }

                let result = creep.moveTo(flag)
                if (result === ERR_NO_PATH) {
                    return FAILURE
                }

                if (result !== OK && result !== ERR_TIRED) {
                    //console.log("failed to move", creep.name, result)
                    return FAILURE
                }

                return RUNNING
            }
        )
    ]
)
