const tracing = require('lib.tracing')
const creeps = require('manager.creeps')
const towers = require('manager.towers')
const colony = require('manager.colony')

const TRACING_ACTIVE = false

const workersLimits = {
    [creeps.WORKER_UPGRADER]: 3,
}

var charter = {
    rooms: ["E18S47", "E17S47", "E18S46", "E17S48", "E19S46"],
    workersLimits
}

module.exports.loop = function () {
    if (TRACING_ACTIVE) {
        tracing.setActive()
    }

    tracing.reset()

    let trace = tracing.startTrace("main")

    console.log("======== TICK", Game.time, "========")


    let colonyTrace = trace.begin("colony")

    const state = colony.tick(charter)
    //console.log("==== Rooms:", JSON.stringify(state.rooms))
    //console.log("==== Builds:", JSON.stringify(state.builds))

    colonyTrace.end()
    let towersTrace = trace.begin("towers")

    towers.tick(charter)

    towersTrace.end()
    let spawnTrace = trace.begin("spawn")

    // Manage creep composition
    creeps.spawnSuicide(state, workersLimits)

    spawnTrace.end()
    let creepsTrace = trace.begin("creeps")

    // Tick creeps
    creeps.tick(creepsTrace)

    creepsTrace.end()
    trace.end()

    tracing.report()

    console.log("--------------------------------")
}
