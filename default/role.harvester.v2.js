const behaviorTree = require('lib.behaviortree')
const { getEnergyReserveTarget } = require('helpers.targets')
const behaviorMovement = require('behavior.movement')
const { getHarvestLocation, resetHarvestTTL, clearAssignment } = require('helpers.energy')
const { numMyCreepsNearby, numEnemeiesNearby } = require('helpers.proximity')
const { MEMORY_HARVEST, MEMORY_ORIGIN } = require('helpers.memory')

const behavior = behaviorTree.SelectorNode(
    "hauler_root",
    [
        behaviorTree.SequenceNode(
            'haul_energy',
            [
                behaviorTree.LeafNode(
                    'pick_source',
                    (creep) => {
                        // Don't look up a new source if creep already has one
                        if (creep.memory[MEMORY_HARVEST]) {
                            let source = Game.getObjectById(creep.memory[MEMORY_HARVEST])
                            behaviorMovement.setSource(creep, source.id)
                            return behaviorTree.SUCCESS
                        }

                        var sources = creep.room.find(FIND_SOURCES)

                        sources = _.filter(sources, (source) => {
                            // Do not send creeps to sources with hostiles near by
                            return numEnemeiesNearby(source.pos, 5) < 1
                        })

                        // Sort by the number of creeps by the source
                        sources = _.sortBy(sources, (source) => {
                            return numMyCreepsNearby(source.pos, 8)
                        })

                        if (!sources || !sources.length) {
                            return behaviorTree.FAILURE
                        }

                        var source = sources[0]

                        behaviorMovement.setSource(creep, source.id)
                        return behaviorTree.SUCCESS
                    }
                ),
                behaviorTree.RepeatUntilFailure(
                    "harvest_until_empty",
                    behaviorTree.SequenceNode(
                        'harvest_energy',
                        [
                            behaviorTree.LeafNode(
                                'move_to_source',
                                (creep) => {
                                    return behaviorMovement.moveToSource(creep, 1)
                                }
                            ),
                            behaviorTree.LeafNode(
                                'fill_creep',
                                (creep) => {
                                    let destination = Game.getObjectById(creep.memory.source)
                                    if (!destination) {
                                        console.log("failed to get destination for harvest", creep.name)
                                        return FAILURE
                                    }

                                    let result = creep.harvest(destination)
                                    if (result === ERR_FULL) {
                                        return behaviorTree.SUCCESS
                                    }
                                    if (result === ERR_NOT_ENOUGH_RESOURCES) {
                                        return behaviorTree.SUCCESS
                                    }
                                    if (creep.store.getFreeCapacity() === 0) {
                                        return behaviorTree.SUCCESS
                                    }
                                    if (result == OK) {
                                        return behaviorTree.RUNNING
                                    }

                                    console.log("failed to harvest energy", creep.name, result)
                                    return behaviorTree.FAILURE
                                }
                            ),
                            behaviorTree.RepeatUntilSuccess(
                                'goto_origin_room',
                                behaviorTree.LeafNode(
                                    'move_to_exit',
                                    (creep) => {
                                        if (!creep.memory[MEMORY_ORIGIN]) {
                                            return behaviorTree.SUCCESS
                                        }

                                        if (creep.room == creep.memory[MEMORY_ORIGIN]) {
                                            return behaviorTree.SUCCESS
                                        }

                                        const exitDir = creep.room.findExitTo(creep.memory[MEMORY_ORIGIN])
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
                                )
                            ),
                            behaviorTree.LeafNode(
                                'pick_storage',
                                (creep) => {
                                    var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                                        filter: (structure) => {
                                            return (structure.structureType == STRUCTURE_EXTENSION ||
                                                    structure.structureType == STRUCTURE_SPAWN ||
                                                    structure.structureType == STRUCTURE_CONTAINER ||
                                                    structure.structureType == STRUCTURE_TOWER) &&
                                                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                                        }
                                    });

                                    if (!target) {
                                        console.log("failed to pick destiantion", creep.name)
                                        return behaviorTree.FAILURE
                                    }

                                    behaviorMovement.setDestination(creep, target.id)
                                    return behaviorTree.SUCCESS
                                }
                            ),
                            behaviorTree.LeafNode(
                                'move_to_storage',
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
                                    if (result === result != ERR_NOT_ENOUGH_RESOURCES) {
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
            console.log("INVESTIGATE: harvester failure", creep.name)
        }
    }
}
