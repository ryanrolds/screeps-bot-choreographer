const behaviorTree = require('lib.behaviortree')
const { getEnergyContainerTargets } = require('helpers.targets')
const behaviorMovement = require('behavior.movement')

const behavior = behaviorTree.SelectorNode(
    "hauler_root",
    [
        behaviorTree.SequenceNode(
            'haul_energy',
            [
                behaviorTree.LeafNode(
                    'pick_supply',
                    (creep) => {
                        let supply = getEnergyContainerTargets(creep)
                        if (!supply) {
                            console.log("failed to pick destiantion", creep.name)
                            return behaviorTree.FAILURE
                        }

                        behaviorMovement.setDestination(creep, supply.id)

                        return behaviorTree.SUCCESS
                    }
                ),
                behaviorTree.LeafNode(
                    'move_to_supply',
                    (creep) => {
                        return behaviorMovement.moveToDestination(creep)
                    }
                ),
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
                behaviorTree.LeafNode(
                    'move_to_room_controller',
                    (creep) => {
                       return behaviorMovement.moveToDestination(creep, 3)
                    }
                ),
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
    run: (creep) => {
        let result = behavior.tick(creep)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: upgrader failure", creep.name)
        }
    }
}
