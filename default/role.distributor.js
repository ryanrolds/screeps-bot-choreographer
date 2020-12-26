
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
    (creep, trace, kingdom) => {
        const room = kingdom.getCreepRoom(creep)
        if (!room) {
            return FAILURE
        }

        const structure = room.getNextEnergyStructure(creep)
        if (!structure) {
            return FAILURE
        }

        behaviorMovement.setDestination(creep, structure.id)
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
                                return FAILURE
                            }

                            let result = creep.transfer(destination, RESOURCE_ENERGY)
                            if (result === ERR_FULL) {
                                // If creep has less then 50 energy, succeed so we get more energy
                                if (creep.store.getUsedCapacity(RESOURCE_ENERGY) < 50) {
                                    return SUCCESS
                                }

                                // We still have energy to transfer, fail so we find another
                                // place to dump
                                return FAILURE
                            }
                            if (result === ERR_NOT_ENOUGH_RESOURCES) {
                                return SUCCESS
                            }
                            if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
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
    run: (creep, trace, kingdom) => {
        const roleTrace = trace.begin('distributor')

        let result = behavior.tick(creep, roleTrace, kingdom)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: distributor failure", creep.name)
        }

        roleTrace.end()
    }
}
