const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const behaviorCommute = require('behavior.commute')
const behaviorStorage = require('behavior.storage')
const behaviorMovement = require('behavior.movement')
const behaviorBuild = require('behavior.build')
const behaviorHarvest = require('behavior.harvest')
const behaviorNonCombatant = require('behavior.noncombatant')
const MEMORY = require('constants.memory')

const behavior = behaviorTree.SequenceNode(
    'haul_energy',
    [
        behaviorHarvest.moveToHarvestRoom,
        behaviorHarvest.selectHarvestSource,
        behaviorHarvest.moveToHarvest,
        behaviorCommute.setCommuteDuration,
        behaviorHarvest.harvest,
        behaviorTree.SelectorNode(
            'dump_or_build',
            [
                behaviorTree.SequenceNode(
                    'dump_energy',
                    [
                        behaviorStorage.selectRoomDropoff,
                        behaviorMovement.moveToDestinationRoom,
                        behaviorMovement.moveToDestination(1),
                        behaviorTree.LeafNode(
                            'empty_creep',
                            (creep) => {
                                let destination = Game.getObjectById(creep.memory[MEMORY.MEMORY_DESTINATION])
                                if (!destination) {
                                    return FAILURE
                                }
            
                                let resource = Object.keys(creep.store).pop()
                                console.log(creep.name, resource)
                                let result = creep.transfer(destination, resource)
                                console.log(creep.name, result)
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
                ),
                behaviorTree.SequenceNode(
                    'build_construction_site',
                    [
                        behaviorBuild.selectSite,
                        behaviorMovement.moveToDestinationRoom,
                        behaviorMovement.moveToDestination(1),
                        behaviorBuild.build
                    ]
                )
            ]
        )
       
    ]
)

module.exports = {
    run: (creep, trace, kingdom) => {
        const roleTrace = trace.begin('harvester')

        let result = behaviorNonCombatant(behavior).tick(creep, roleTrace, kingdom)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: harvester failure", creep.name)
        }

        roleTrace.end()
    }
}
