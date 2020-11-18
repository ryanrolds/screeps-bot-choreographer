
const behaviorTree = require('lib.behaviortree')
const { getEnergyContainerTargets, getEnergyReserveTarget } = require('helpers.targets')
const behaviorMovement = require('behavior.movement')
const { MEMORY_WITHDRAW } = require('helpers.memory')

const behavior = behaviorTree.SelectorNode(
    "hauler_root",
    [
        behaviorTree.SequenceNode(
            'haul_energy',
            [
                behaviorTree.RepeatUntilSuccess(
                    'withdraw_until_full',
                    behaviorTree.SequenceNode(
                        'get_energy',
                        [
                            behaviorTree.LeafNode(
                                'pick_supply',
                                (creep) => {
                                    if (creep.memory[MEMORY_WITHDRAW]) {
                                        let container = Game.getObjectById(creep.memory[MEMORY_WITHDRAW])
                                        behaviorMovement.setDestination(creep, container.id)
                                        return behaviorTree.SUCCESS
                                    }

                                    let supply = getEnergyContainerTargets(creep)
                                    if (!supply) {
                                        console.log("failed to pick energy supply", creep.name)
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

                                    if (result === ERR_NOT_ENOUGH_RESOURCES) {
                                        return behaviorTree.FAILURE
                                    }

                                    if (result === ERR_FULL) {
                                        return behaviorTree.SUCCESS
                                    }

                                    if (creep.store.getFreeCapacity() === 0) {
                                        return behaviorTree.SUCCESS
                                    }

                                    console.log("failed to withdraw from supply", creep.name, result)
                                    return behaviorTree.FAILURE
                                }
                            ),
                        ]
                    )
                ),
                behaviorTree.RepeatUntilSuccess(
                    "transfer_until_empty",
                    behaviorTree.SequenceNode(
                        'dump_energy',
                        [
                            behaviorTree.SelectorNode(
                                'pick_dump',
                                [
                                    behaviorTree.LeafNode(
                                        'pick_spawner_extractor',
                                        (creep) => {
                                            let sink = getEnergyReserveTarget(creep)
                                            if (!sink) {
                                                return behaviorTree.FAILURE
                                            }

                                            behaviorMovement.setDestination(creep, sink.id)
                                            return behaviorTree.SUCCESS
                                        }
                                    ),
                                    behaviorTree.LeafNode(
                                        'pick_container_near_spawner',
                                        (creep) => {
                                            const target = Game.spawns['Spawn1'].pos.
                                                findClosestByRange(FIND_STRUCTURES, {
                                                    filter: function(structure) {
                                                        return structure.structureType === STRUCTURE_CONTAINER &&
                                                            structure.store.getFreeCapacity() > 0
                                                    }
                                                });

                                            if (!target) {
                                                return behaviorTree.FAILURE
                                            }

                                            behaviorMovement.setDestination(creep, target.id)
                                            return behaviorTree.SUCCESS
                                        }
                                    )
                                ]
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
                                        console.log("failed to get destination for dump", creep.name)
                                        return behaviorTree.FAILURE
                                    }

                                    let result = creep.transfer(destination, RESOURCE_ENERGY)
                                    if (result === ERR_FULL) {
                                        // We still have energy to transfer, fail so we find another
                                        // place to dump
                                        return behaviorTree.FAILURE
                                    }
                                    if (result === ERR_NOT_ENOUGH_RESOURCES) {
                                        return behaviorTree.SUCCESS
                                    }
                                    if (creep.store.getUsedCapacity() === 0) {
                                        return behaviorTree.SUCCESS
                                    }
                                    if (result != OK) {
                                        return behaviorTree.FAILURE
                                    }

                                    return behaviorTree.RUNNING
                                }
                            )
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
            console.log("INVESTIGATE: hauler failure", creep.name)
        }
    }
}
