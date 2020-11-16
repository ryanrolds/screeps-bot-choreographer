const creeps = require('manager.creeps')

module.exports.loop = function () {
    console.log("================================")
    console.log("TICK", Game.time)
    console.log("================================")

    const workersLimits = {
        [creeps.WORKER_HARVESTER]: 2,
        [creeps.WORKER_UPGRADER]: 5,
        [creeps.WORKER_BUILDER]: 2,
        [creeps.WORKER_REPAIRER]: 1,
        [creeps.WORKER_HAULER]: 4,
        [creeps.WORKER_DEFENDER]: 0
    }

    // Manage creep composition
    creeps.spawnSuicide(workersLimits)

    // Tick creeps
    creeps.tick()
}
