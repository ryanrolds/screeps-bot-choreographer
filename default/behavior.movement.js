const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const MEMORY_DESTINATION = 'destination'
const MEMORY_SOURCE = 'source'

const moveToMemory = module.exports.moveToMemory = (creep, memoryId, range) => {
    let destination = Game.getObjectById(creep.memory[memoryId])
    if (!destination) {
        //console.log("failed to get destination for movement", creep.name)
        return FAILURE
    }

    return moveTo(creep, destination, range)
}

const moveTo = module.exports.moveTo = (creep, destination, range) => {
    if (creep.pos.inRangeTo(destination, range)) {
        return SUCCESS
    }

    let result = creep.moveTo(destination)
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

module.exports.setDestination = (creep, destinationId) => {
    creep.memory[MEMORY_DESTINATION] = destinationId
}

module.exports.moveToDestination = (creep, range = 1) => {
    return moveToMemory(creep, MEMORY_DESTINATION, range)
}


module.exports.clearDestination = (creep) => {
    delete creep.memory[MEMORY_DESTINATION]
}


module.exports.fillCreepFromDestination = (creep) => {
    let destination = Game.getObjectById(creep.memory.destination)
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

    //console.log("failed to withdraw from supply", creep.name, result)
    return behaviorTree.FAILURE
}
