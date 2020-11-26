var WORKER_BUILDER = module.exports.WORKER_BUILDER = "builder"
var WORKER_HARVESTER = module.exports.WORKER_HARVESTER = "harvester"
var WORKER_REMOTE_HARVESTER = module.exports.WORKER_REMOTE_HARVESTER = "remote_harvester"
var WORKER_REMOTE_MINER = module.exports.WORKER_REMOTE_MINER = "remote_miner"
var WORKER_MINER = module.exports.WORKER_MINER = "miner"
var WORKER_UPGRADER = module.exports.WORKER_UPGRADER = "upgrader"
var WORKER_DEFENDER = module.exports.WORKER_DEFENDER = "defender"
var WORKER_ATTACKER = module.exports.WORKER_ATTACKER = "attacker"
var WORKER_REPAIRER = module.exports.WORKER_REPAIRER = "repairer"
var WORKER_HAULER = module.exports.WORKER_HAULER = "hauler"
var WORKER_DISTRIBUTOR = module.exports.WORKER_DISTRIBUTOR = "distributor"
var WORKER_CLAIMER = module.exports.WORKER_CLAIMER = "claimer"
var WORKER_EXPLORER = module.exports.WORKER_EXPLORER = "claimer"

const definitions = {
    [WORKER_HARVESTER]: {
        energyLimit: 600,
        parts: [CARRY, MOVE, WORK, WORK]
    },
    [WORKER_REMOTE_HARVESTER]:{
        energyLimit: 1000,
        parts: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, WORK, MOVE, WORK, MOVE]
    },
    [WORKER_REMOTE_MINER]: {
        energyLimit: 400,
        parts: [CARRY, MOVE, WORK, WORK, WORK]
    },
    [WORKER_MINER]: {
        energyLimit: 800,
        parts: [CARRY, MOVE, WORK, WORK, WORK, WORK, WORK, WORK, WORK]
    },
    [WORKER_HAULER]: {
        energyLimit: 1000,
        parts: [MOVE, CARRY, MOVE, CARRY, MOVE, CARRY]
    },
    [WORKER_BUILDER]: {
        energyLimit: 900,
        parts: [CARRY, MOVE, WORK, MOVE, WORK, MOVE]
    },
    [WORKER_REPAIRER]: {
        energyLimit: 600,
        parts: [CARRY, MOVE, CARRY, MOVE, WORK, MOVE]
    },
    [WORKER_UPGRADER]: {
        energyLimit: 800,
        parts: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE, WORK, WORK]
    },
    [WORKER_DISTRIBUTOR]: {
        energyLimit: 1000,
        parts: [CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]
    },
    [WORKER_CLAIMER]: {
        energyLimit: 1300,
        parts: [MOVE, CLAIM]
    },
    [WORKER_EXPLORER]: { // Deprecated - use claimer
        energyLimit: 1300,
        parts: [MOVE, CLAIM]
    },
    [WORKER_DEFENDER]: {
        energyLimit: null,
        parts: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK]
    },
    [WORKER_ATTACKER]: {
        energyLimit: null,
        parts: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK]
    }
}

module.exports = {
    // V1 Deprecated
    WORKER_BUILDER,
    WORKER_HARVESTER,
    WORKER_REMOTE_HARVESTER,
    WORKER_MINER,
    WORKER_REMOTE_MINER,
    WORKER_UPGRADER,
    WORKER_DEFENDER,
    WORKER_ATTACKER,
    WORKER_REPAIRER,
    WORKER_HAULER,
    WORKER_DISTRIBUTOR,
    WORKER_CLAIMER,
    WORKER_EXPLORER,
    // V2
    definitions
}
