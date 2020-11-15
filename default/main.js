const creeps = require('manager.creeps')

module.exports.loop = function () {
    const workersLimits = {
        [creeps.WORKER_HARVESTER]: 7,
        [creeps.WORKER_UPGRADER]: 1,
        [creeps.WORKER_BUILDER]: 3,
        [creeps.WORKER_REPAIRER]: 1,
        [creeps.WORKER_HAULER]: 0,
        [creeps.WORKER_DEFENDER]: 0
    }

    // Manage creep composition
    creeps.spawnSuicide(workersLimits)
    // Tick creeps
    creeps.tick()
}