const behaviorTree = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')
const behaviorBuild = require('behavior.build')

const behavior = behaviorTree.SelectorNode(
    "hauler_root",
    [
        behaviorTree.SequenceNode(
            'haul_energy',
            [
                behaviorTree.SelectorNode(
                    'get_energy',
                    [
                        behaviorStorage.fillCreep,
                        behaviorTree.RepeatUntilSuccess(
                            'repeat_harvest',
                            behaviorTree.SequenceNode(
                                'harvest_if_needed',
                                [
                                    behaviorHarvest.selectHarvestSource,
                                    behaviorHarvest.moveToHarvest,
                                    behaviorHarvest.harvest
                                ]
                            )
                        )
                    ]
                ),
                behaviorTree.RepeatUntilSuccess(
                    'build_until_empty',
                    behaviorTree.SequenceNode(
                        'build_construction_site',
                        [
                            behaviorBuild.selectSiteNearFlag,
                            behaviorMovement.moveToDestinationRoom,
                            behaviorMovement.moveToDestination(1),
                            behaviorBuild.build
                        ]
                    )
                )
            ]
        )
    ]
)

module.exports = {
    run: (creep) => {
        let result = behavior.tick(creep)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: builder failure", creep.name)
        }
    }
}
