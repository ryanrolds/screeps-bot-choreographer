const roleHarvesterV2 = require('role.harvester.v2');
const roleUpgraderV2 = require('role.upgrader.v2');
const roleBuilderV2 = require('role.builder.v2');
const roleRepairerV2 = require('role.repairer.v2');
const roleHaulerV2 = require('role.hauler.v2');
const roleDistributor = require('role.distributor');
const roleDefender = require('role.defender');
const roleClaimerV2 = require('role.claimer.v2');
const roleAttacker = require('role.attacker')

const CREEPS = require('constants.creeps')
const { definitions } = require('constants.creeps')
const { MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_COLONY } = require('constants.memory')

module.exports.tick = (trace) => {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        //console.log(creep.name, creep.memory.role)

        if (creep.spawning) {
            return
        }

        if (creep.memory.role == CREEPS.WORKER_ATTACKER) {
            roleAttacker.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_HARVESTER ||
            creep.memory.role == CREEPS.WORKER_REMOTE_HARVESTER ||
            creep.memory.role == CREEPS.WORKER_MINER ||
            creep.memory.role == CREEPS.WORKER_REMOTE_MINER) {
            roleHarvesterV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_UPGRADER) {
            roleUpgraderV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_BUILDER) {
            roleBuilderV2.run(creep, trace);
        }

        if (creep.memory.role == CREEPS.WORKER_DEFENDER) {
            roleDefender.run(creep, trace);
        }

        if (creep.memory.role == CREEPS.WORKER_REPAIRER) {
            roleRepairerV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_HAULER) {
            roleHaulerV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS. WORKER_CLAIMER ||
            creep.memory.role == CREEPS.WORKER_EXPLORER) {
            roleClaimerV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_DISTRIBUTOR) {
            roleDistributor.run(creep, trace)
        }
    }

    // Cleanup old creep memory
    for(var i in Memory.creeps) {
        if (!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
}

module.exports.createCreepV2 = (colony, room, role, memory, energy) => {
    console.log(role)
    const definition = definitions[role]

    const energyLimit = definition.energyLimit
    if (energyLimit && energy > energyLimit) {
        energy = energyLimit
    }

    let parts = getBodyParts(definition.parts, energy)

    const name = role + '_' + Game.time;
    memory[MEMORY_COLONY] = colony
    memory[MEMORY_ORIGIN] = room
    memory[MEMORY_ROLE] = role

    console.log(`==== Creating creep ${role}, ${parts}, ${memory}`)
    return Game.spawns['Spawn1'].spawnCreep(parts, name, {memory});
}

// Deprecated
module.exports.createCreep = (role, maxEnergy, memory = {}) => {
    let roleParts = CREEPS.roles[role]
    var parts = getBodyParts(roleParts, maxEnergy)

    var name = role + '_' + Game.time;
    memory[MEMORY_ROLE] = role
    memory[MEMORY_ORIGIN] = Game.spawns['Spawn1'].room.name

    console.log(`==== Creating creep ${role}, ${parts}, ${memory}`)
    return Game.spawns['Spawn1'].spawnCreep(parts, name, {memory});
}

function getBodyParts(roleParts, maxEnergy) {
    let parts = roleParts
    let i = 0
    let total = 0

    while (true) {
        let nextPart = roleParts[i % roleParts.length]
        let estimate = parts.concat([nextPart]).reduce((acc, part) => {
            return acc + BODYPART_COST[part]
        }, 0)

        //console.log("estimate", estimate, maxEnergy)

        if (estimate < maxEnergy && parts.length <= 50) {
            parts.push(nextPart)
            total = estimate

            // console.log("under estimated parts", parts, estimate, maxEnergy)
        } else {
            // console.log("over estimated parts", parts, estimate, maxEnergy)
            break
        }

        i++
    }

    console.log("using parts for", parts, total, maxEnergy)

    return parts
}
