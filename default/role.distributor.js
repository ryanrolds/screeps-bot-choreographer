
const behaviorTree = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')
const { getEnergyContainerTargets } = require('helpers.targets')
const { MEMORY_WITHDRAW, MEMORY_DESTINATION } = require('constants.memory')

const behavior = behaviorTree.SequenceNode(
    'distributor_root',
    [
        behaviorStorage.fillCreep,
        behaviorStorage.emptyCreep
    ]
)

module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('distributor')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: distributor failure", creep.name)
        }

        roleTrace.end()
    }
}
