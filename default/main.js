var creeps = require('process.creeps')

module.exports.loop = function () {
    // Manage creep composition
    creeps.spawnSuicide()
    // Tick creeps
    creeps.tick()
}