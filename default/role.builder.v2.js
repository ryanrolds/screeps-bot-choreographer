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
                            console.log("failed to pick energy storage", creep.name)
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
                    'pick_construction_site',
                    (creep) => {
                        var flags = creep.room.find(FIND_FLAGS, {
                            filter: (flag) => {
                                return flag.name.startsWith("builder")
                            }
                        });

                        let target = null
                        if (flags.length) {
                            target = flags[0].pos.findClosestByPath(FIND_CONSTRUCTION_SITES)
                        } else {
                            target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES)
                        }

                        behaviorMovement.setDestination(creep, target.id)
                        return behaviorTree.SUCCESS
                    }
                ),
                behaviorTree.LeafNode(
                    'move_to_damaged',
                    (creep) => {
                       return behaviorMovement.moveToDestination(creep)
                    }
                ),
                behaviorTree.LeafNode(
                    'empty_creep',
                    (creep) => {
                        let destination = Game.getObjectById(creep.memory.destination)
                        if (!destination) {
                            console.log("failed to get destination for build", creep.name)
                            return behaviorTree.FAILURE
                        }

                        let result = creep.build(destination)
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
            console.log("builder failure", creep.name)
        }
    }
}
