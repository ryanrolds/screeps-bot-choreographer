const tracing = require('lib.tracing')
const Kingdom = require('org.kingdom')
const towers = require('manager.towers')
const helpersCreeps = require('helpers.creeps')

const TRACING_ACTIVE = false

var charter = {
    id: "E18S47-Shard3",
    rooms: [
        "E18S47", "E17S47", "E18S46", "E17S48", "E19S46", "E18S48"
    ],
}

module.exports.loop = function () {
    if (TRACING_ACTIVE) {
        tracing.setActive()
    }

    tracing.reset()

    let trace = tracing.startTrace("main")

    console.log("======== TICK", Game.time, "========")

    let kingdomTrace = trace.begin("kingdom")

    const kingdom = new Kingdom({
        "E18S47": charter
    })
    kingdom.update()
    kingdom.process()

    kingdomTrace.end()

    // TODO bring towers into the Kingdom model
    let towersTrace = trace.begin("towers")
    towers.tick(charter)
    towersTrace.end()

    let creepsTrace = trace.begin("creeps")
    // Tick creeps
    // TODO bring crepes into the Kingdom model
    helpersCreeps.tick(creepsTrace)
    creepsTrace.end()

    trace.end()
    tracing.report()

    kingdom.updateStats()

    console.log("--------------------------------")
}
