const behaviorTree = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')
const behaviorBuild = require('behavior.build')
const behaviorRoom = require('behavior.room')

const behavior = behaviorTree.SelectorNode(
    "builder_root",
    [
        behaviorTree.SequenceNode(
            'build',
            [
                // TODO use behavior.room.getEnergy()
                behaviorTree.RepeatUntilSuccess(
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
    run: (creep, trace) => {
        const roleTrace = trace.begin('builder')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: builder failure", creep.name)
        }

        roleTrace.end()
    }
}
