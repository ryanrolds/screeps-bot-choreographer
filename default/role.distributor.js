
const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')
const { MEMORY_ROLE, MEMORY_DESTINATION } = require('constants.memory')
const { WORKER_DISTRIBUTOR } = require('constants.creeps')

// The goal is to not tell two  Distributors to go to the same structure needing
// energy. So, we lookup all the currently assigned destinations and subtract those
// from the list of structures needing energy. Then we find the closest structure
// needing energy
const selectDestination = behaviorTree.LeafNode(
    'select_distributor_transfer',
    (creep) => {
        let room = creep.room
        let assignedDestinations = _.reduce(Game.creeps, (acc, c) => {
            // We want a list of current destinations for current Distributors
            // Return if any of them
            if (c.room.name !== room.name || c.memory[MEMORY_ROLE] !== WORKER_DISTRIBUTOR ||
                !c.memory[MEMORY_DESTINATION]) {
                return acc
            }

            acc.push(c.memory[MEMORY_DESTINATION])

            return acc
        }, [])

        let destinations = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return ( // Fill extensions and spawns with room
                    (structure.structureType == STRUCTURE_EXTENSION ||
                        structure.structureType == STRUCTURE_LINK ||
                        structure.structureType == STRUCTURE_SPAWN) &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                ) || ( // Will towers with more than 250 capacity
                    (structure.structureType == STRUCTURE_TOWER) &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 250
                )
            }
        });

        // Filter out destinations that are already assigned to another Distributor
        destinations = _.filter(destinations, (structure) => {
            return assignedDestinations.indexOf(structure.id) === -1
        })

        // Of the unassigned destinations, get the closest
        let closest = creep.pos.findClosestByRange(destinations)
        if (!closest) {
            return FAILURE
        }

        behaviorMovement.setDestination(creep, closest.id)
        return SUCCESS
    }
)

const behavior = behaviorTree.SequenceNode(
    'distributor_root',
    [
        behaviorStorage.fillCreep,
        behaviorTree.RepeatUntilSuccess(
            "transfer_until_empty",
            behaviorTree.SequenceNode(
                'dump_energy',
                [
                    selectDestination,
                    behaviorMovement.moveToDestination(1),
                    behaviorTree.LeafNode(
                        'empty_creep',
                        (creep) => {
                            let destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION])
                            if (!destination) {
                                console.log("failed to get destination for dump", creep.name)
                                return FAILURE
                            }

                            let result = creep.transfer(destination, RESOURCE_ENERGY)
                            if (result === ERR_FULL) {
                                // We still have energy to transfer, fail so we find another
                                // place to dump
                                return FAILURE
                            }
                            if (result === ERR_NOT_ENOUGH_RESOURCES) {
                                return SUCCESS
                            }
                            if (creep.store.getUsedCapacity() === 0) {
                                return SUCCESS
                            }
                            if (result != OK) {
                                return FAILURE
                            }

                            return RUNNING
                        }
                    )
                ]
            )
        )
    ]
)

module.exports = {
    run: (creep, trace) => {
        const roleTrace = trace.begin('distributor')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: distributor failure", creep.name)
        }

        roleTrace.end()
    }
}
