const roleHarvesterV2 = require('role.harvester.v2');
const roleUpgraderV2 = require('role.upgrader.v2');
const roleBuilderV2 = require('role.builder.v2');
const roleRepairerV2 = require('role.repairer.v2');
const roleHaulerV2 = require('role.hauler.v2');
const roleDistributor = require('role.distributor');
const roleDefender = require('role.defender');
const roleClaimerV2 = require('role.claimer.v2');
const roleAttacker = require('role.attacker')
const roleReserver = require('role.reserver')

const CREEPS = require('constants.creeps')
const { definitions } = require('constants.creeps')
const { MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_COLONY } = require('constants.memory')

module.exports.tick = (trace) => {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
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

        if (creep.memory.role == CREEPS.WORKER_HAULER ||
            creep.memory.role == CREEPS.WORKER_REMOTE_HAULER) {
            roleHaulerV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS. WORKER_CLAIMER ||
            creep.memory.role == CREEPS.WORKER_EXPLORER) {
            roleClaimerV2.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_DISTRIBUTOR) {
            roleDistributor.run(creep, trace)
        }

        if (creep.memory.role == CREEPS.WORKER_RESERVER) {
            roleReserver.run(creep, trace)
        }
    }

    // Cleanup old creep memory
    for(var i in Memory.creeps) {
        if (!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
}

module.exports.createCreepV2 = (colony, room, spawn, role, memory, energy, energyLimit) => {
    const definition = definitions[role]

    const ignoreSpawnEnergyLimit = definition.ignoreSpawnEnergyLimit || false
    const roleEnergyLimit = definition.energyLimit
    if (roleEnergyLimit && energy > roleEnergyLimit) {
        energy = roleEnergyLimit
    }

    if (energy > energyLimit && !ignoreSpawnEnergyLimit) {
        energy = energyLimit
    }

    let parts = getBodyParts(definition, energy)

    const name = role + '_' + Game.time;
    memory[MEMORY_COLONY] = colony
    memory[MEMORY_ORIGIN] = room
    memory[MEMORY_ROLE] = role

    console.log(`==== Creating creep ${colony}, ${room}, ${role}, ${parts}, ${JSON.stringify(memory)}`)

    let result = spawn.spawnCreep(parts, name, {memory});

    console.log(`RESULT: ${result}, ${colony}, ${room}, ${role}`)

    return result
}

function getBodyParts(definition, maxEnergy) {
    let base = definition.base.slice(0)
    let i = 0
    let total = 0

    while (true) {
        let nextPart = definition.parts[i % definition.parts.length]
        let estimate = base.concat([nextPart]).reduce((acc, part) => {
            return acc + BODYPART_COST[part]
        }, 0)

        if (estimate <= maxEnergy && base.length <= 50) {
            base.push(nextPart)
            total = estimate
        } else {
            break
        }

        i++
    }

    console.log("using parts for", base, total, maxEnergy)

    return base
}
