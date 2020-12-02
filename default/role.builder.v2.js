const behaviorTree = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorBuild = require('behavior.build')
const behaviorAssign = require('behavior.assign')
const behaviorRoom = require('behavior.room')

const behavior = behaviorTree.SequenceNode(
    'builder_root',
    [
        behaviorAssign.moveToRoom,
        behaviorRoom.getEnergy,
        behaviorTree.RepeatUntilSuccess(
            'build_until_empty',
            behaviorTree.SequenceNode(
                'build_construction_site',
                [
                    behaviorBuild.selectSite,
                    behaviorMovement.moveToDestinationRoom,
                    behaviorMovement.moveToDestination(1),
                    behaviorBuild.build
                ]
            )
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
