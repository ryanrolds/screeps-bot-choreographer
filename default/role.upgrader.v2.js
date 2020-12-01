const behaviorTree = require('lib.behaviortree')
const behaviorAssign = require('behavior.assign')
const behaviorRoom = require('behavior.room')
const behaviorMovement = require('behavior.movement')

const behavior = behaviorTree.SequenceNode(
    "hauler_root",
    [
        behaviorAssign.moveToRoom,
        behaviorRoom.getEnergy,
        behaviorTree.LeafNode(
            'pick_room_controller',
            (creep) => {
                behaviorMovement.setDestination(creep, creep.room.controller.id)
                return behaviorTree.SUCCESS
            }
        ),
        behaviorMovement.moveToDestination(3),
        behaviorTree.RepeatUntilSuccess(
            'upgrade_until_empty',
            behaviorTree.LeafNode(
                'empty_creep',
                (creep) => {
                    let destination = Game.getObjectById(creep.memory.destination)
                    if (!destination) {
                        return behaviorTree.FAILURE
                    }

                    let result = creep.upgradeController(creep.room.controller)
                    if (result == ERR_NOT_ENOUGH_RESOURCES) {
                        return behaviorTree.SUCCESS
                    }
                    if (result != OK) {
                        return behaviorTree.FAILURE
                    }
                    if (creep.store.getUsedCapacity() === 0) {
                        return behaviorTree.SUCCESS
                    }

                   return behaviorTree.RUNNING
                }
            )
        )
    ]
)


module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('upgrader')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: upgrader failure", creep.name)
        }

        roleTrace.end()
    }
}
