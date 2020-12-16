const roleHarvesterV2 = require('role.harvester.v2');
const roleUpgraderV2 = require('role.upgrader.v2');
const roleBuilderV2 = require('role.builder.v2');
const roleRepairerV2 = require('role.repairer.v2');
const roleHaulerV2 = require('role.hauler.v2');
const roleHaulerV3 = require('role.hauler.v3');
const roleMiner = require('role.miner');
const roleDistributor = require('role.distributor');
const roleDefender = require('role.defender');
const roleClaimerV2 = require('role.claimer.v2');
const roleAttacker = require('role.attacker')
const roleReserver = require('role.reserver')

const CREEPS = require('constants.creeps')
const MEMORY = require('constants.memory')

const { definitions } = require('constants.creeps')
const { MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_COLONY } = require('constants.memory')

module.exports.tick = (kingdom, trace) => {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        if (creep.spawning) {
            return
        }

        // TODO move the below to a map and/or lookup function

        if (creep.memory.role == CREEPS.WORKER_ATTACKER) {
            roleAttacker.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_MINER ||
            creep.memory.role == CREEPS.WORKER_REMOTE_MINER) {
            roleMiner.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_HARVESTER ||
            creep.memory.role == CREEPS.WORKER_REMOTE_HARVESTER) {
            roleHarvesterV2.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_UPGRADER) {
            roleUpgraderV2.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_BUILDER) {
            roleBuilderV2.run(creep, trace, kingdom);
        }

        if (creep.memory.role == CREEPS.WORKER_DEFENDER) {
            roleDefender.run(creep, trace, kingdom);
        }

        if (creep.memory.role == CREEPS.WORKER_REPAIRER) {
            roleRepairerV2.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_HAULER ||
            creep.memory.role == CREEPS.WORKER_REMOTE_HAULER) {
            roleHaulerV2.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_HAULER_V3) {
            roleHaulerV3.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS. WORKER_CLAIMER ||
            creep.memory.role == CREEPS.WORKER_EXPLORER) {
            roleClaimerV2.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_DISTRIBUTOR) {
            roleDistributor.run(creep, trace, kingdom)
        }

        if (creep.memory.role == CREEPS.WORKER_RESERVER) {
            roleReserver.run(creep, trace, kingdom)
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
    memory[MEMORY.MEMORY_START_TICK] = Game.time

    console.log(`==== Creating creep ${colony}, ${room}, ${role}, ${parts}, ${JSON.stringify(memory)}`)

    let result = spawn.spawnCreep(parts, name, {memory});

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

    base = _.sortBy(base, (part) => {
        switch (part) {
        case TOUGH:
            return 0
        case WORK:
        case CARRY:
            return 1
        case MOVE:
            return 2
        case ATTACK:
            return 8
        case RANGED_ATTACK:
            return 9
        case HEAL:
            return 10
        default:
            return 1
        }
    })

    return base
}