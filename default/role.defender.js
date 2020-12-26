const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorAssign = require('behavior.assign')

const { MEMORY_ASSIGN_ROOM } = require('constants.memory')
const behaviorMovement = require('behavior.movement')

const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')
const behaviorBuild = require('behavior.build')
const { PID_SUFFIX_D } = require('./constants.memory')

const behavior = behaviorTree.SequenceNode(
    "defender_root",
    [
        behaviorAssign.moveToRoom,
        behaviorTree.LeafNode(
            'attack_hostiles',
            (creep) => {
                let hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS)
                if (!hostile) {
                    return SUCCESS
                }

                const inRange = creep.pos.getRangeTo(hostile) <= 3
                if (inRange) {
                    let result = creep.rangedAttack(hostile)
                    console.log('attack', creep.name, result)
                }

                let pathToHostile = creep.pos.findPathTo(hostile)
                const lastRampart = pathToHostile.reduce((lastRampart, pos) => {
                    const posStructures = creep.pos.lookFor(LOOK_STRUCTURES)
                    const hasRampart = _.filter(posStructures, (structure) => {
                        return structure.structureType === STRUCTURE_RAMPART
                    })

                    const hasCreep = creep.pos.lookFor(LOOK_STRUCTURES).length > 0

                    if (hasRampart && !hasCreep) {
                        lastRampart = pos
                    }

                    return lastRampart
                }, null)

                console.log("last rampart", creep.name, lastRampart)

                if (lastRampart) {
                    creep.moveTo(lastRampart, {visualizePathStyle: {stroke: '#ffffff'}})
                    return RUNNING
                }

                const creepPosStructures = creep.pos.lookFor(LOOK_STRUCTURES)
                const inRampart = _.filter(creepPosStructures, (structure) => {
                    return structure.structureType === STRUCTURE_RAMPART
                }).length > 0

                console.log("in rampart", creep.name, inRampart)

                if (inRampart) {
                    return RUNNING
                }

                result = creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
                if (result === ERR_NO_BODYPART) {
                    return FAILURE
                }
                if (result === ERR_INVALID_TARGET) {
                    return FAILURE
                }
                if (result === ERR_NOT_IN_RANGE) {
                    return FAILURE
                }

                return RUNNING
            }
        )
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
