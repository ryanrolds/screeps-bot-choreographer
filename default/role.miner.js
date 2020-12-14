const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const behaviorNonCombatant = require('behavior.noncombatant')
const behaviorMovement = require('behavior.movement')
const behaviorCommute = require('behavior.commute')
const behaviorHarvest = require('behavior.harvest')

const MEMORY = require('constants.memory')

const harvest = behaviorTree.LeafNode(
    'fill_creep',
    (creep) => {
        let destination = Game.getObjectById(creep.memory.source)
        if (!destination) {
            return FAILURE
        }

        let result = creep.harvest(destination)
        if (result === ERR_FULL) {
            return SUCCESS
        }
        if (creep.store.getFreeCapacity() === 0) {
            return SUCCESS
        }
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            return FAILURE
        }
        if (result === OK) {
            return RUNNING
        }

        return FAILURE
    }
)

const janitor = behaviorTree.LeafNode(
    'janitor',
    (creep) => {
        // Locate dropped resource close to creep
        let resource = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1)
        if (!resource) {
            return FAILURE
        }

        let result = creep.pickup(resource[0])
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

const emptyCreep = behaviorTree.SequenceNode(
    'empty_creep',
    [
        behaviorTree.LeafNode(
            'pick_adjacent_container',
            (creep) => {
                var targets = creep.pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets || !targets.length) {
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'move_to_destination',
            (creep) => {
                let destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION])
                if (!destination) {
                    return FAILURE
                }

                if (creep.pos.inRangeTo(destination, 1)) {
                    return SUCCESS
                }

                const result = creep.moveTo(destination)
                if (result === ERR_NO_PATH) {
                    return FAILURE
                }
                if (result !== OK && result !== ERR_TIRED) {
                    return FAILURE
                }

                return RUNNING
            }
        ),
        behaviorTree.LeafNode(
            'empty_creep',
            (creep) => {
                let destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION])
                if (!destination) {
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

const behavior = behaviorTree.SequenceNode(
    'haul_energy',
    [
        behaviorHarvest.moveToHarvestRoom,
        behaviorHarvest.selectHarvestSource,
        behaviorHarvest.moveToHarvest,
        behaviorCommute.setCommuteDuration,
        behaviorTree.SelectorNode(
            'get_energy',
            [
                harvest,
                janitor
            ]
        ),
        emptyCreep
    ]
)

module.exports = {
    run: (creep, trace, kingdom) => {
        const roleTrace = trace.begin('miner')

        let result = behaviorNonCombatant(behavior).tick(creep, roleTrace, kingdom)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: miner failure", creep.name)
        }

        roleTrace.end()
    }
}
