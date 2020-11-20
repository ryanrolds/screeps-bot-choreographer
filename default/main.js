const creeps = require('manager.creeps')
const towers = require('manager.towers')
const colony = require('manager.colony')

const workersLimits = {
    [creeps.WORKER_UPGRADER]: 4,
}

var charter = {
    rooms: ["E18S47", "E17S47", "E18S46", "E17S48", "E19S46"],
    workersLimits
}

module.exports.loop = function () {
    console.log("======== TICK", Game.time, "========")

    const state = colony.tick(charter)
    //console.log("==== Rooms:", JSON.stringify(state.rooms))
    //console.log("==== Builds:", JSON.stringify(state.builds))

    towers.tick(charter)

    // Manage creep composition
    creeps.spawnSuicide(state, workersLimits)

    // Tick creeps
    creeps.tick()

    console.log("--------------------------------")
}
