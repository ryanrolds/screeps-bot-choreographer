const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const behaviorMovement = require('behavior.movement')
const behaviorHarvest = require('behavior.harvest')

const { MEMORY_ROLE, MEMORY_DESTINATION, MEMORY_ORIGIN } = require('constants.memory')
const { WORKER_HAULER, WORKER_DISTRIBUTOR, WORKER_REMOTE_HAULER,  WORKER_HAULER_V3 } = require('constants.creeps')

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
        if (result == OK) {
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
        console.log("resource", creep.name, resource)
        if (!resource) {
            return FAILURE
        }

        let result = creep.pickup(resource[0])
        console.log("pickup", creep.name, result)
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
                const role = creep.memory[MEMORY_ROLE]
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
            'empty_creep',
            (creep) => {
                let destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION])
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
    run: (creep, trace) => {
        const roleTrace = trace.begin('miner')

        let result = behavior.tick(creep, roleTrace)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: miner failure", creep.name)
        }

        roleTrace.end()
    }
}
