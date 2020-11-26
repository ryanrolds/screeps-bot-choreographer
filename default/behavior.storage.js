
const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorMovement = require('behavior.movement')
const { MEMORY_ROLE, MEMORY_DESTINATION, MEMORY_ORIGIN } = require('constants.memory')
const { WORKER_HAULER, WORKER_DISTRIBUTOR } = require('constants.creeps')

const selectEnergyForWithdraw = module.exports.selectEnergyForWithdraw = behaviorTree.LeafNode(
    'selectEnergyForWithdraw',
    (creep) => {
        // If not in primary room, fail
        if (creep.room.name !== Game.spawns['Spawn1'].room.name) {
            return FAILURE
        }

        var targets = Game.spawns['Spawn1'].pos.findInRange(FIND_STRUCTURES, 8, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_CONTAINER ||
                    structure.structureType == STRUCTURE_STORAGE) &&
                    structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
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

const selectContainerForWithdraw = module.exports.selectContainerForWithdraw = behaviorTree.LeafNode(
    'selectContainerForWithdraw',
    (creep) => {
        var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_CONTAINER ||
                    structure.structureType == STRUCTURE_STORAGE) &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });

        if (!target) {
            console.log("failed to pick container", creep.name)
            return FAILURE
        }

        behaviorMovement.setDestination(creep, target.id)
        return SUCCESS
    }
)

const selectRoomDropoff = module.exports.selectRoomDropoff = behaviorTree.SelectorNode(
    'selectRoomDropoff',
    [
        behaviorTree.LeafNode(
            'pick_tower',
            (creep) => {
                const role = creep.memory[MEMORY_ROLE] || null
                if (role !== WORKER_HAULER && role !==  WORKER_DISTRIBUTOR) {
                    return FAILURE
                }

                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                var targets = room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_TOWER &&
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 250;
                    }
                });

                if (!targets.length) {
                    console.log("failed to pick destination", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_adjacent_container',
            (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                // haulers should pick containers near the spawner
                // TODO this is hacky and feels bad
                if (role && (role === WORKER_HAULER || role ===  WORKER_DISTRIBUTOR)) {
                    return FAILURE
                }

                var targets = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets || !targets.length) {
                    console.log("failed to pick destination", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_storage',
            (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                if (role && role ===  WORKER_DISTRIBUTOR) {
                    return FAILURE
                }

                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                if (!room.storage) {
                    return FAILURE
                }

                let distributors = room.find(FIND_MY_CREEPS, {
                    filter: (creep) => {
                        return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR
                    }
                })

                if (!distributors.length) {
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, room.storage.id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_container',
            (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                if (role && role ===  WORKER_DISTRIBUTOR) {
                    return FAILURE
                }

                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                let distributors = room.find(FIND_MY_CREEPS, {
                    filter: (creep) => {
                        return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR
                    }
                })

                if (!distributors.length) {
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
        ),
        behaviorTree.LeafNode(
            'pick_spawner_extension',
            (creep) => {
                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                let targets = room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN) &&
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets.length) {
                    console.log("failed to pick destination", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
    ]
)

const pickStorage = module.exports.pickStorage = behaviorTree.SelectorNode(
    'pickStorage',
    [
        behaviorTree.LeafNode(
            'pick_adjacent_container',
            (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                // haulers should pick containers near the spawner
                // TODO this is hacky and feels bad
                if (role && role === WORKER_HAULER || role ===  WORKER_DISTRIBUTOR) {
                    return FAILURE
                }

                var targets = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_CONTAINER &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets || !targets.length) {
                    console.log("failed to pick destination", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_spawner_extension',
            (creep) => {
                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                let targets = room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN) &&
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
                });

                if (!targets.length) {
                    console.log("failed to pick destination", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_tower',
            (creep) => {
                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                var targets = room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return structure.structureType == STRUCTURE_TOWER &&
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 100;
                    }
                });

                if (!targets.length) {
                    console.log("failed to pick destination", creep.name)
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, targets[0].id)
                return SUCCESS
            }
        ),
        behaviorTree.LeafNode(
            'pick_storage',
            (creep) => {
                let originID = creep.memory[MEMORY_ORIGIN]
                if (!originID) {
                    return FAILURE
                }

                let room = Game.rooms[originID]
                if (!room) {
                    return FAILURE
                }

                if (!room.storage) {
                    return FAILURE
                }

                behaviorMovement.setDestination(creep, room.storage.id)
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

module.exports.fillCreepFrom = (from) => {
    return behaviorTree.SequenceNode(
        `fill_creep_from_${from}`,
        [
            from,
            behaviorMovement.moveToDestination(1),
            behaviorTree.LeafNode(
                'fill_creep_from_destination',
                (creep) => {
                    return behaviorMovement.fillCreepFromDestination(creep)
                }
            )
        ]
    )
}

module.exports.fillCreepFromContainers = behaviorTree.SequenceNode(
    'energy_supply',
    [
        selectContainerForWithdraw,
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
            selectRoomDropoff,
            behaviorMovement.moveToDestinationRoom,
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

                    //console.log("xxxxx transfer", creep.name, result)

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

