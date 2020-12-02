const tracing = require('lib.tracing')
const Kingdom = require('org.kingdom')
const towers = require('manager.towers')
const helpersCreeps = require('helpers.creeps')

const TRACING_ACTIVE = false

var charter = {
    id: "W22S21-Shard3",
    primary: "W22S21",
    rooms: [
        "W22S21"
    ]
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
        "W22S21": {
            id: "W22S21-Shard3",
            primary: "W22S21",
            rooms: [
                "W22S21"
            ]
        }
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
