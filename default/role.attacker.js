const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorFlag = require('behavior.flag')

const behavior = behaviorTree.SequenceNode(
    "attacker_root",
    [
        behaviorFlag.moveToFlag,
        behaviorTree.LeafNode(
            'attack_hostiles',
            (creep) => {
                let hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS)
                if (hostile) {
                    if(creep.rangedAttack(hostile) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
                    }

                    return RUNNING
                }

                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'attack_structures',
            (creep) => {
                let hostile = creep.pos.findClosestByPath(FIND_HOSTILE_STRUCTURES)
                if (hostile) {
                    if(creep.rangedAttack(hostile) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
                    }

                    return RUNNING
                }

                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'attack_spawns',
            (creep) => {
                let hostile = creep.pos.findClosestByPath(FIND_HOSTILE_SPAWNS)
                if (hostile) {
                    if(creep.rangedAttack(hostile) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
                    }

                    return RUNNING
                }

                return SUCCESS
            }
        ),
        // TODO attack turrets
        // TODO attack RC
        // TODO attack walls/ramparts
    ]
)

module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('attacker')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: attacker failure", creep.name)
        }

        roleTrace.end()
    }
}
