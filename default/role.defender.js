const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorAssign = require('behavior.assign')

const { MEMORY_ASSIGN_ROOM } = require('constants.memory')
const behaviorMovement = require('behavior.movement')

const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')
const behaviorBuild = require('behavior.build')

const behavior = behaviorTree.SequenceNode(
    "defender_root",
    [
        behaviorAssign.moveToRoom,
        behaviorTree.LeafNode(
            'attack_hostiles',
            (creep) => {
                let hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS)
                if (hostile) {
                    let result = creep.rangedAttack(hostile)
                    if (result === ERR_NO_BODYPART) {
                        return FAILURE
                    }
                    if (result === ERR_INVALID_TARGET) {
                        return FAILURE
                    }
                    if (result === ERR_NOT_IN_RANGE) {
                        creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
                    }

                    return RUNNING
                }

                return SUCCESS
            }
        ),
    ]
)

module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('defender')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: defender failure", creep.name)
        }

        roleTrace.end()
    }
}
