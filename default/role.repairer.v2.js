const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const behaviorMovement = require('behavior.movement')
const behaviorCommute = require('behavior.commute')
const behaviorAssign = require('behavior.assign')
const behaviorRoom = require('behavior.room')
const behaviorNonCombatant = require('behavior.noncombatant')

const { MEMORY_DESTINATION } = require('constants.memory')
const { getDamagedStructure } = require('helpers.targets')

const selectStructureToRepair = behaviorTree.LeafNode(
    'selectStructureToRepair',
    (creep, trace, kingdom) => {
        const room = kingdom.getCreepRoom(creep)
        if (!room) {
            return FAILURE
        }

        let target = room.getNextDamagedStructure()
        if (!target) {
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

const behavior = behaviorTree.SequenceNode(
    'repair',
    [
        behaviorAssign.moveToRoom,
        behaviorCommute.setCommuteDuration,
        behaviorRoom.getEnergy,
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

module.exports = {
    run: (creep, trace, kingdom) => {
        const roleTrace = trace.begin('repairer')

        let result = behaviorNonCombatant(behavior).tick(creep, roleTrace, kingdom)
        if (result == behaviorTree.FAILURE) {
            console.log("INVESTIGATE: repairer failure", creep.name)
        }

        roleTrace.end()
    }
}
