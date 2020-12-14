const behaviorTree = require('lib.behaviortree')
const behaviorCommute = require('behavior.commute')
const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')

const behavior = behaviorTree.SequenceNode(
    'haul_energy',
    [
        behaviorHarvest.moveToHarvestRoom,
        behaviorHarvest.selectHarvestSource,
        behaviorHarvest.moveToHarvest,
        behaviorCommute.setCommuteDuration,
        behaviorHarvest.harvest,
        behaviorStorage.emptyCreep
    ]
)

module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('harvester')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: harvester failure", creep.name)
        }

        roleTrace.end()
    }
}
