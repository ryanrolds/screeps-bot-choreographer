const behaviorTree = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')

const behavior = behaviorTree.SequenceNode(
    'haul_energy',
    [
        behaviorHarvest.moveToHarvestRoom,
        behaviorHarvest.selectHarvestSource,
        behaviorHarvest.moveToHarvest,
        behaviorHarvest.harvest,
        behaviorMovement.moveToOriginRoom,
        behaviorStorage.emptyCreep
    ]
)

module.exports = {
    run: (creep) => {
        let result = behavior.tick(creep)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: harvester failure", creep.name)
        }
    }
}
