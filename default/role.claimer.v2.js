
const behaviorTree = require('lib.behaviortree')
const { getEnergyContainerTargets, getEnergyReserveTarget } = require('helpers.targets')
const behaviorMovement = require('behavior.movement')
const { MEMORY_CLAIM } = require('helpers.memory')

const behavior = behaviorTree.SelectorNode(
    "claimer_root",
    [
        behaviorTree.SequenceNode(
            'go_to_claim_room',
            [
                behaviorTree.LeafNode(
                    'move_to_room',
                    (creep) => {
                        const exitDir = creep.room.findExitTo(creep.memory[MEMORY_CLAIM])
                        console.log("exit", exitDir)

                        if (exitDir === ERR_INVALID_ARGS) {
                            return behaviorTree.SUCCESS
                        }

                        const exit = creep.pos.findClosestByRange(exitDir);
                        const result = creep.moveTo(exit);
                        if (result === ERR_INVALID_ARGS) {
                            return behaviorTree.FAILURE
                        }

                        return behaviorTree.RUNNING
                    }
                ),
                behaviorTree.RepeatUntilSuccess(
                    'move_to_rc',
                    behaviorTree.LeafNode(
                        'move',
                        (creep) => {
                            behaviorMovement.moveTo(creep, creep.room.controller, 1)
                        }
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
            console.log("INVESTIGATE: claimer failure", creep.name)
        }
    }
}
