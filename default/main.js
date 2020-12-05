const tracing = require('lib.tracing')
const Kingdom = require('org.kingdom')
const towers = require('manager.towers')
const helpersCreeps = require('helpers.creeps')

const TRACING_ACTIVE = false

let config = {
    "E18S48": {
        id: "E18S48-Shard3",
        primary: "E18S48",
        rooms: ["E18S48", "E17S48", "E16S48"]
    },
    "E18S47": {
        id: "E18S47-Shard3",
        primary: "E18S47",
        rooms: ["E18S47", "E17S47", "E18S46", "E19S46"]
    }
}

if (Game.shard.name === "shardSeason") {
    config = {
        "W22S21": {
            id: "W22S21-Shard3",
            primary: "W22S21",
            rooms: [
                "W22S21",
                "W21S21",
                "W22S22",
                "W21S22"
            ]
        }
    }
}

module.exports.loop = function () {
    if (TRACING_ACTIVE) {
        tracing.setActive()
    }

    tracing.reset()

    let trace = tracing.startTrace("main")

    console.log("======== TICK", Game.time, "========")

    let kingdomTrace = trace.begin("kingdom")

    const kingdom = new Kingdom(config)
    kingdom.update()
    kingdom.process()

    kingdomTrace.end()

    // TODO bring towers into the Kingdom model
    let towersTrace = trace.begin("towers")
    towers.tick()
    towersTrace.end()

    let creepsTrace = trace.begin("creeps")
    // Tick creeps
    // TODO bring crepes into the Kingdom model
    helpersCreeps.tick(kingdom, creepsTrace)
    creepsTrace.end()

    trace.end()
    tracing.report()

    kingdom.updateStats()

    console.log("--------------------------------")
}
