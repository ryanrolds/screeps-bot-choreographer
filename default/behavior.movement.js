const behaviorTree = require('lib.behaviortree')
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')
const { MEMORY_DESTINATION, MEMORY_DESTINATION_ROOM, MEMORY_ORIGIN,
    MEMORY_SOURCE, MEMORY_SOURCE_ROOM } = require('constants.memory')

const moveToMemory = module.exports.moveToMemory = (creep, memoryId,  range) => {
    let destination = Game.getObjectById(creep.memory[memoryId])
    if (!destination) {
        console.log("failed to get destination for movement", creep.name)
        return FAILURE
    }

    return moveTo(creep, destination, range)
}

const moveTo = module.exports.moveTo = (creep, destination, range) => {
    if (creep.pos.inRangeTo(destination, range)) {
        return SUCCESS
    }

    let result = creep.moveTo(destination, {reusePath: 25, maxOps: 500})
    if (result === ERR_NO_PATH) {
        return FAILURE
    }

    if (result !== OK && result !== ERR_TIRED) {
        //console.log("failed to move", creep.name, result)
        return FAILURE
    }

    return RUNNING
}

module.exports.setSource = (creep, sourceId) => {
    creep.memory[MEMORY_SOURCE] = sourceId
}

module.exports.moveToSource = (creep, range) => {
    return moveToMemory(creep, MEMORY_SOURCE, range)
}

module.exports.clearSource = (creep) => {
    delete creep.memory[MEMORY_SOURCE]
}

module.exports.setDestination = (creep, destinationId, roomId = null) => {
    creep.memory[MEMORY_DESTINATION] = destinationId

    if (roomId) {
        creep.memory[MEMORY_DESTINATION_ROOM] = roomId
    }
}

module.exports.moveToDestination = (range = 1) => {
    return behaviorTree.LeafNode(
        'bt.movement.moveToDestiantion',
        (creep) => {
            return moveToMemory(creep, MEMORY_DESTINATION, range)
        }
    )
}

module.exports.clearDestination = (creep) => {
    delete creep.memory[MEMORY_DESTINATION]
}

module.exports.fillCreepFromDestination = (creep) => {
    let destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION])
    if (!destination) {
        //console.log("failed to get destination for withdraw", creep.name)
        return FAILURE
    }

    let result = creep.withdraw(destination, RESOURCE_ENERGY)
    if (result === OK) {
        return RUNNING
    }

    if (result === ERR_FULL) {
        return SUCCESS
    }

    if (result === ERR_NOT_ENOUGH_RESOURCES) {
        return SUCCESS
    }

    return FAILURE
}

module.exports.moveToDestinationRoom = behaviorTree.RepeatUntilSuccess(
    'bt.movement.moveToDestinationRoom',
    behaviorTree.LeafNode(
        'move_to_exit',
        (creep) => {
            if (!creep.memory[MEMORY_DESTINATION_ROOM]) {
                return SUCCESS
            }

            if (creep.room.name === creep.memory[MEMORY_DESTINATION_ROOM]) {
                return SUCCESS
            }

            const exitDir = creep.room.findExitTo(creep.memory[MEMORY_DESTINATION_ROOM])
            if (exitDir === ERR_INVALID_ARGS) {
                return SUCCESS
            }

            const exit = creep.pos.findClosestByRange(exitDir);
            const result = creep.moveTo(exit);
            if (result === ERR_INVALID_ARGS) {
                return FAILURE
            }

            return RUNNING
        }
    )
)

module.exports.moveToOriginRoom = behaviorTree.RepeatUntilSuccess(
    'goto_origin_room',
    behaviorTree.LeafNode(
        'move_to_exit',
        (creep) => {
            if (!creep.memory[MEMORY_ORIGIN]) {
                return SUCCESS
            }

            if (creep.room.name === creep.memory[MEMORY_ORIGIN]) {
                return SUCCESS
            }

            const exitDir = creep.room.findExitTo(creep.memory[MEMORY_ORIGIN])
            if (exitDir === ERR_INVALID_ARGS) {
                return SUCCESS
            }

            const exit = creep.pos.findClosestByRange(exitDir);

            const result = creep.moveTo(exit);
            if (result === ERR_INVALID_ARGS) {
                return FAILURE
            }

            return RUNNING
        }
    )
)
