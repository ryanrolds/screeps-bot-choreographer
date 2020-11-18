
const behaviorTree = require('lib.behaviortree')
const { getEnergyContainerTargets, getEnergyReserveTarget } = require('helpers.targets')
const behaviorMovement = require('behavior.movement')
const { MEMORY_CLAIM } = require('helpers.memory')

const behavior = behaviorTree.SelectorNode(
    "claimer_root",
    [

    ]
)

module.exports = {
    run: (creep) => {
        let result = behavior.tick(creep)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: claimer failure", creep.name)
        }
    }
}
