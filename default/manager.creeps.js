const roleHarvesterV2 = require('role.harvester.v2');
const roleUpgraderV2 = require('role.upgrader.v2');
const roleBuilderV2 = require('role.builder.v2');
const roleRepairerV2 = require('role.repairer.v2');
const roleHaulerV2 = require('role.hauler.v2');
const roleDefender = require('role.defender');
const roleClaimerV2 = require('role.claimer.v2');
const { MEMORY_HARVEST, MEMORY_WITHDRAW, MEMORY_CLAIM, MEMORY_ROLE, MEMORY_ORIGIN } = require('helpers.memory')

var WORKER_BUILDER = module.exports.WORKER_BUILDER = "builder"
var WORKER_HARVESTER = module.exports.WORKER_HARVESTER = "harvester"
var WORKER_REMOTE_HARVESTER = module.exports.WORKER_REMOTE_HARVESTER = "remote_harvester"
var WORKER_UPGRADER = module.exports.WORKER_UPGRADER = "upgrader"
var WORKER_DEFENDER = module.exports.WORKER_DEFENDER = "defender"
var WORKER_REPAIRER = module.exports.WORKER_REPAIRER = "repairer"
var WORKER_HAULER = module.exports.WORKER_HAULER = "hauler"
var WORKER_CLAIMER = module.exports.WORKER_CLAIMER = "claimer"
var WORKER_EXPLORER = module.exports.WORKER_EXPLORER = "claimer"

const workerRoles = {
    [WORKER_HARVESTER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_REMOTE_HARVESTER]: [CARRY, MOVE, WORK, MOVE, WORK],
    [WORKER_BUILDER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_UPGRADER]: [CARRY, CARRY, MOVE, WORK],
    [WORKER_DEFENDER]: [TOUGH, TOUGH, TOUGH, MOVE, RANGED_ATTACK],
    [WORKER_REPAIRER]: [CARRY, CARRY, MOVE, WORK],
    [WORKER_HAULER]: [CARRY, CARRY, MOVE, MOVE],
    [WORKER_CLAIMER]: [MOVE, CLAIM, MOVE, MOVE],
    [WORKER_EXPLORER]: [MOVE, CLAIM, MOVE, MOVE]
}

const buildOrder = [WORKER_BUILDER, WORKER_HAULER, WORKER_UPGRADER, WORKER_REPAIRER, WORKER_DEFENDER]

module.exports.spawnSuicide = (state, limits) => {
    // Manage the bar at which we build creeps
    let maxEnergy = Game.spawns['Spawn1'].room.energyCapacityAvailable
    let currentEnergy = Game.spawns['Spawn1'].room.energyAvailable
    let minEnergy = _.max([300, maxEnergy * 0.6])
    //console.log("energy", currentEnergy, maxEnergy, minEnergy)

    let currentWorkers = _.countBy(Game.creeps, (creep) => {
        return creep.memory.role
    })
    console.log(JSON.stringify(currentWorkers))

    if (!Game.spawns['Spawn1'].spawning && currentEnergy >= minEnergy) {
        // Check that all sources have a harvester and hauler if needed
        const energySources = state.sources.energy
        let energySourceIDs = Object.keys(state.sources.energy)

        // Sort the spawning room sources to the front
        energySourceIDs = _.sortBy(energySourceIDs, (sourceID) => {
            return Game.spawns['Spawn1'].room.name == state.sources.energy[sourceID].roomID ? 0 : 9999
        })

        for (let i = 0; i < energySourceIDs.length; i++) {
            let source = energySources[energySourceIDs[i]]

            let desiredMiners = 3
            let desiredHaulers = 0

            if (source.containerID) {
                desiredMiners = 1
                desiredHaulers = 1

                let container = Game.getObjectById(source.containerID)
                if (container && container.store.getUsedCapacity() > 1500) {
                    desiredHaulers = 2
                }
            }

            const differentRoom = Game.spawns['Spawn1'].room.name !== source.roomID

            // We need at least twice as many workers if the source
            // is in another room
            if (differentRoom) {
                //desiredMiners = desiredMiners * 2
                //desiredHaulers = desiredHaulers * 2
            }

            if (source.numMiners < desiredMiners) {
                let harvesterType = WORKER_HARVESTER
                if (differentRoom) {
                    harvesterType = WORKER_REMOTE_HARVESTER
                }

                let result = createCreep(harvesterType, currentEnergy, {
                    [MEMORY_HARVEST]: source.id,
                })
                if (result != OK) {
                    console.log("problem creating harvester", result)
                }

                return
            }

            if (source.numHaulers < desiredHaulers) {
                let result = createCreep(WORKER_HAULER, currentEnergy, {[MEMORY_WITHDRAW]: source.containerID})
                if (result != OK) {
                    console.log("problem creating hauler", result)
                }

                return
            }
        }

        // Maintain desired number of general units
        for (let i = 0; i < buildOrder.length; i++) {
            let role = buildOrder[i]
            let max = limits[role]
            let count = currentWorkers[role] || 0
            if (count < max) {
                let result = createCreep(role, currentEnergy)
                return
            } if (count > max * 2) {
                suicideWorker(role)
                return
            }
        }

        const roomsToExplore = state.explore
        const roomIDs = Object.keys(roomsToExplore)
        for (let i = 0; i < roomIDs.length; i++) {
            let explore = roomsToExplore[roomIDs[i]]
            console.log(JSON.stringify(explore))
            if (!explore.hasExplorer) {
                let result = createCreep(WORKER_CLAIMER, currentEnergy, {[MEMORY_CLAIM]: explore.id})
                if (result != OK) {
                    console.log("problem creating claimer", result)
                }
            }
        }

        /*
        // ====================================
        // Track ticks that the spawner is full and creates an upgraded if full for too long
        if (!Game.spawns['Spawn1'].memory.fullTicks) {
            Game.spawns['Spawn1'].memory.fullTicks = 0
        }

        if (currentEnergy >= maxEnergy) {
            Game.spawns['Spawn1'].memory.fullTicks++
        } else {
            Game.spawns['Spawn1'].memory.fullTicks = 0
        }

        console.log("upgrader", currentWorkers[WORKER_UPGRADER], limits[WORKER_UPGRADER])

        if (Game.spawns['Spawn1'].memory.fullTicks >= AUTO_BUILD_UPGRADER_FULL_TICKS &&
            (currentWorkers[WORKER_UPGRADER] < limits[WORKER_UPGRADER] * 2)) {
            console.log("Auto building upgrader")
            let result = createCreep(WORKER_UPGRADER, currentEnergy)
            if (result == ERR_NOT_ENOUGH_ENERGY) {
                Game.spawns['Spawn1'].memory.energyAvailable = false
            }

            return
        }
        // ====================================
        */

        // If there is no need to spawn a creep at this time let workers
        // user the spawner/extractor energy
        Game.spawns['Spawn1'].memory.energyAvailable = true
    }

    if (Game.spawns['Spawn1'].spawning) {
        var spawningCreep = Game.creeps[Game.spawns['Spawn1'].spawning.name];
        Game.spawns['Spawn1'].room.visual.text(
            '🛠️' + spawningCreep.memory.role,
            Game.spawns['Spawn1'].pos.x + 1,
            Game.spawns['Spawn1'].pos.y,
            {align: 'left', opacity: 0.8});
    }
}

module.exports.tick = () => {
    for(var name in Game.creeps) {
        var creep = Game.creeps[name];
        //console.log(creep.name, creep.memory.role)

        if (creep.spawning) {
            return
        }

        if(creep.memory.role == WORKER_HARVESTER || creep.memory.role == "harvater") {
            //roleHarvester.run(creep);
            roleHarvesterV2.run(creep)
        }

        if(creep.memory.role == WORKER_UPGRADER) {
            roleUpgraderV2.run(creep)
        }

        if(creep.memory.role == WORKER_BUILDER) {
            roleBuilderV2.run(creep);
        }

        if(creep.memory.role == WORKER_DEFENDER) {
            roleDefender.run(creep);
        }

        if(creep.memory.role == WORKER_REPAIRER) {
            roleRepairerV2.run(creep)
        }

        if(creep.memory.role == WORKER_HAULER) {
            roleHaulerV2.run(creep)
        }

        if(creep.memory.role == WORKER_CLAIMER) {
            roleClaimerV2.run(creep)
        }
    }

    // Cleanup old creep memory
    for(var i in Memory.creeps) {
        if (!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
}

function createCreep(role, maxEnergy, memory = {}) {
    var parts = getBodyParts(role, maxEnergy)
    var name = role + '_' + Game.time;
    memory[MEMORY_ROLE] = role
    memory[MEMORY_ORIGIN] = Game.spawns['Spawn1'].room.name
    return Game.spawns['Spawn1'].spawnCreep(parts, name, {memory});
}

function getBodyParts(role, maxEnergy) {
    let roleDef = workerRoles[role]
    let parts = roleDef

    let i = 0
    let total = 0

    while (true) {
        let nextPart = roleDef[i % roleDef.length]
        let estimate = parts.concat([nextPart]).reduce((acc, part) => {
            return acc + BODYPART_COST[part]
        }, 0)

        //console.log("estiamte", estimate, maxEnergy)

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

    console.log("using parts for", role, parts, total, maxEnergy)

    return parts
}

function suicideWorker(role) {
    for (let name in Game.creeps) {
        let creep = Game.creeps[name];
        if (creep.memory.role === role) {
            console.log('Suiciding creep:', creep.name);
            creep.suicide()
            break
        }
    }
}
