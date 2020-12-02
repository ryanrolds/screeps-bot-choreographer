const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')

module.exports.getEnergy = behaviorTree.RepeatUntilSuccess(
    'get_energy_until_success',
    behaviorTree.SelectorNode(
        'get_energy',
        [
            behaviorStorage.fillCreepFromContainers,
            behaviorTree.SequenceNode(
                'harvest_if_needed',
                [
                    behaviorHarvest.selectHarvestSource,
                    behaviorHarvest.moveToHarvest,
                    behaviorHarvest.harvest
                ]
            )
        ]
    )
)
