
const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const { MEMORY_ROLE, MEMORY_DESTINATION } = require('helpers.memory')

const selectEnergyForWithdraw = module.exports.selectEnergyForWithdraw = behaviorTree.LeafNode(
    'pick_central_storage',
    (creep) => {
        // If not in primary room, fail
        if (creep.room.name !== Game.spawns['Spawn1'].room.name) {
            return FAILURE
        }

        var targets = Game.spawns['Spawn1'].pos.findInRange(FIND_STRUCTURES, 8, {
            filter: (structure) => {
                return structure.structureType == STRUCTURE_CONTAINER &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });

        if (!targets || !targets.length) {
            console.log("failed to pick container near spawn", creep.name)
            return FAILURE
        }

        behaviorMovement.setDestination(creep, targets[0].id)
        return SUCCESS
    }
)

const pickStorage = module.exports.pickStorage = behaviorTree.SelectorNode(
    'pick_storage',
    [
        behaviorTree.LeafNode(
            'pick_adjecent_container',
            (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                // haulers should pick containers near the spawner
                if (role && role === "hauler") {
                    return FAILURE
                }

                var targets = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets || !targets.length) {
                    console.log("failed to pick destiantion", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_spawner_extension',
            (creep) => {
                var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN) &&
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!target) {
                    console.log("failed to pick destiantion", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, target.id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_tower',
            (creep) => {
                var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_TOWER &&
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 100;
                    }
                });

                if (!target) {
                    console.log("failed to pick destiantion", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, target.id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_container',
            (creep) => {
                var targets = Game.spawns['Spawn1'].pos.findInRange(FIND_STRUCTURES, 8, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets || !targets.length) {
                    console.log("failed to pick container near spawn", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        )
    ]
)

module.exports.fillCreep = behaviorTree.SequenceNode(
    'energy_supply',
    [
        selectEnergyForWithdraw,
        behaviorMovement.moveToDestination(1),
        behaviorTree.LeafNode(
            'fill_creep',
            (creep) => {
                return behaviorMovement.fillCreepFromDestination(creep)
            }
        )
    ]
)

module.exports.emptyCreep = behaviorTree.RepeatUntilSuccess(
    "transfer_until_empty",
    behaviorTree.SequenceNode(
        'dump_energy',
        [
            pickStorage,
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

