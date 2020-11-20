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
            "moveToRC",
            (creep) => {
                return behaviorMovement.moveTo(creep, creep.room.controller, 1)
            }
        ),
        behaviorTree.LeafNode(
            'defend_room',
            (creep) => {
                let hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS)
                if (hostile) {
                    if(creep.rangedAttack(hostile) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
                    }
                }

                return RUNNING
            }
        )
    ]
)

module.exports = {
    run: (creep) => {
        let result = behavior.tick(creep)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: defender failure", creep.name)
        }
    }
}
