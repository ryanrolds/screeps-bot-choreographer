const behaviorTree = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')

const behavior = behaviorTree.SelectorNode(
    "hauler_root",
    [
        behaviorTree.SequenceNode(
            'haul_energy',
            [
                behaviorStorage.selectRoomDropoff,
                behaviorMovement.moveToDestination(1),
                behaviorTree.LeafNode(
                    'fill_creep',
                    (creep) => {
                        return behaviorMovement.fillCreepFromDestination(creep)
                    }
                ),
                behaviorTree.LeafNode(
                    'pick_room_controller',
                    (creep) => {
                        behaviorMovement.setDestination(creep, creep.room.controller.id)
                        return behaviorTree.SUCCESS
                    }
                ),
                behaviorMovement.moveToDestination(3),
                behaviorTree.LeafNode(
                    'empty_creep',
                    (creep) => {
                        let destination = Game.getObjectById(creep.memory.destination)
                        if (!destination) {
                            console.log("failed to get destination for withdraw", creep.name)
                            return behaviorTree.FAILURE
                        }

                        let result = creep.upgradeController(creep.room.controller)
                        if (result != OK) {
                            return behaviorTree.FAILURE
                        }

                        if (creep.store.getUsedCapacity() === 0) {
                            return behaviorTree.SUCCESS
                        }

                       return behaviorTree.RUNNING
                    }
                ),
            ]
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
