const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree')

const MEMORY_DESTINATION = 'destination'

module.exports.setDestination = (creep, destinationId) => {
    creep.memory[MEMORY_DESTINATION] = destinationId
}

module.exports.moveToDestination = (creep) => {
    let destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION])
    if (!destination) {
        console.log("failed to get destination for movement", creep.name)
        return FAILURE
    }

    if (creep.pos.isNearTo(destination)) {
        return SUCCESS
    }

    let result = creep.moveTo(destination)

    if (result !== OK && result !== ERR_TIRED) {
        console.log("failed to move", result)
        return FAILURE
    }

    return RUNNING
}

module.exports.clearDestination = (creep) => {

}
