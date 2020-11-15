
const behaviorTree = require('lib.behaviortree')
const { getEnergyContainerTargets, getEnergyReserveTarget } = require('helpers.targets')
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
                        let destination = Game.getObjectById(creep.memory.destination)
                        if (!destination) {
                            console.log("failed to get destination for withdraw", creep.name)
                            return behaviorTree.FAILURE
                        }

                        let result = creep.withdraw(destination, RESOURCE_ENERGY)
                        if (result === OK) {
                            return behaviorTree.RUNNING
                        }

                        if (result === ERR_FULL) {
                            return behaviorTree.SUCCESS
                        }

                        if (result === ERR_NOT_ENOUGH_RESOURCES) {
                            return behaviorTree.SUCCESS
                        }

                        console.log("failed to withdraw from supply", creep.name, result)
                        return behaviorTree.FAILURE
                    }
                ),
                behaviorTree.LeafNode(
                    'pick_sink',
                    (creep) => {
                        let sink = getEnergyReserveTarget(creep)
                        if (!sink) {
                            console.log("failed to pick destiantion", creep.name)
                            return behaviorTree.FAILURE
                        }

                        behaviorMovement.setDestination(creep, sink.id)

                        return behaviorTree.SUCCESS
                    }
                ),
                behaviorTree.LeafNode(
                    'move_to_sink',
                    (creep) => {
                       return behaviorMovement.moveToDestination(creep)
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

                        let result = creep.transfer(destination, RESOURCE_ENERGY)
                        if (result == ERR_FULL) {
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
                ),
            ]
        )
    ]
)

module.exports = {
    run: (creep) => {
        let result = behavior.tick(creep)
        if (result == behaviorTree.FAILURE) {
            console.log("hauler failure", creep.name)
        }
    }
}
