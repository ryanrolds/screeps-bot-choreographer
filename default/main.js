const creeps = require('manager.creeps')
const towers = require('manager.towers')

var colony = require('colony')

var charter = {
    rooms: ["E18S47", "E17S47"]
}

module.exports.loop = function () {
    console.log("================================")
    console.log("TICK", Game.time)
    console.log("================================")

    const state = colony.tick(charter)
    console.log(JSON.stringify(state))

    towers.tick(charter)

    const workersLimits = {
        [creeps.WORKER_UPGRADER]: 5,
        [creeps.WORKER_BUILDER]: 4,
        [creeps.WORKER_REPAIRER]: 0,
        [creeps.WORKER_DEFENDER]: 0
    }

    // Manage creep composition
    creeps.spawnSuicide(state, workersLimits)

    // Tick creeps
    creeps.tick()
}
