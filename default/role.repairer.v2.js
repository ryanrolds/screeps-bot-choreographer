const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const behaviorMovement = require('behavior.movement')
const behaviorStorage = require('behavior.storage')
const behaviorHarvest = require('behavior.harvest')
const behaviorAssign = require('behavior.assign')

const { MEMORY_DESTINATION } = require('constants.memory')
const { getDamagedStructure } = require('helpers.targets')

const selectStructureToRepair = behaviorTree.LeafNode(
    'selectStructureToRepair',
    (creep) => {
        let target = getDamagedStructure(creep)
        if (!target) {
            console.log("failed to pick damaged structure", creep.name)
            return FAILURE
        }

        behaviorMovement.setDestination(creep, target.id)
        return SUCCESS
    }
)

const repair = behaviorTree.LeafNode(
    'repair_structure',
    (creep) => {
        let destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION])
        if (!destination) {
            console.log("failed to get destination for withdraw", creep.name)
            return FAILURE
        }

        let result = creep.repair(destination)

        // TODO this should not be a failure, I need to makea RepeatCondition node
        if (destination.hits >= destination.hitsMax) {
            return FAILURE
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

const behavior = behaviorTree.SelectorNode(
    "repairer_root",
    [
        behaviorTree.SequenceNode(
            'repair',
            [
                behaviorTree.SelectorNode(
                    'get_energy',
                    [
                        behaviorStorage.fillCreep,
                        behaviorTree.RepeatUntilSuccess(
                            'repeat_harvest',
                            behaviorTree.SequenceNode(
                                'harvest_if_needed',
                                [
                                    behaviorHarvest.selectHarvestSource,
                                    behaviorHarvest.moveToHarvest,
                                    behaviorHarvest.harvest
                                ]
                            )
                        )
                    ]
                ),
                behaviorAssign.moveToRoom,
                behaviorTree.RepeatUntilSuccess(
                    'repair_until_empty',
                    behaviorTree.SequenceNode(
                        'select_and_repair',
                        [
                            selectStructureToRepair,
                            behaviorMovement.moveToDestination(1),
                            repair
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
        if (result == FAILURE) {
            console.log("INVESTIGATE: repairer failure", creep.name)
        }
    }
}
