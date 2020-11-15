const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleDefender = require('role.defender');
const roleRepairer = require('role.repairer');
const roleHauler = require('role.hauler');
const roleHaulerV2 = require('role.hauler.v2');

var WORKER_BUILDER = module.exports.WORKER_BUILDER = "builder"
var WORKER_HARVESTER = module.exports.WORKER_HARVESTER = "harvester"
var WORKER_UPGRADER = module.exports.WORKER_UPGRADER = "upgrader"
var WORKER_DEFENDER = module.exports.WORKER_DEFENDER = "defender"
var WORKER_REPAIRER = module.exports.WORKER_REPAIRER = "repairer"
var WORKER_HAULER = module.exports.WORKER_HAULER = "hauler"

const workerRoles = {
    [WORKER_HARVESTER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_BUILDER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_UPGRADER]: [CARRY, CARRY, MOVE, WORK],
    [WORKER_DEFENDER]: [TOUGH, TOUGH, TOUGH, MOVE, RANGED_ATTACK],
    [WORKER_REPAIRER]: [CARRY, CARRY, MOVE, WORK],
    [WORKER_HAULER]: [CARRY, CARRY, CARRY, MOVE]
}

const buildOrder = [WORKER_HAULER, WORKER_HARVESTER, WORKER_UPGRADER, WORKER_BUILDER,
    WORKER_REPAIRER, WORKER_DEFENDER]

const AUTO_BUILD_UPGRADER_FULL_TICKS = 10

module.exports.spawnSuicide = (limits) => {
    // Manage the bar at which we build creeps
    let maxEnergy = Game.spawns['Spawn1'].room.energyCapacityAvailable
    let currentEnergy = Game.spawns['Spawn1'].room.energyAvailable
    let minEnergy = _.max([300, maxEnergy * 0.8])
    //console.log("energy", currentEnergy, maxEnergy, minEnergy)

    if (!Game.spawns['Spawn1'].spawning) {
        let currentWorkers = _.countBy(Game.creeps, (creep) => {
            return creep.memory.role
        })

        console.log(JSON.stringify(currentWorkers))

        for (let i = 0; i < buildOrder.length; i++) {
            let role = buildOrder[i]
            let max = limits[role]
            let count = currentWorkers[role] || 0
            if (count < max) {
                let result = createCreep(role, currentEnergy)
                if (result == ERR_NOT_ENOUGH_ENERGY) {
                    Game.spawns['Spawn1'].memory.energyAvailable = false
                }

                return
            } if (count > max * 2) {
                suicideWorker(role)
                return
            }
        }

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

        if(creep.memory.role == WORKER_HARVESTER || creep.memory.role == "harvater") {
            roleHarvester.run(creep);
        }

        if(creep.memory.role == WORKER_UPGRADER) {
            roleUpgrader.run(creep);
        }

        if(creep.memory.role == WORKER_BUILDER) {
            roleBuilder.run(creep);
        }

        if(creep.memory.role == WORKER_DEFENDER) {
            roleDefender.run(creep);
        }

        if(creep.memory.role == WORKER_REPAIRER) {
            roleRepairer.run(creep);
        }

        if(creep.memory.role == WORKER_HAULER) {
            //roleHauler.run(creep)
            roleHaulerV2.run(creep)
        }
    }

    // Cleanup old creep memory
    for(var i in Memory.creeps) {
        if (!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
}

function createCreep(role, maxEnergy) {
    var name = role + '_' + Game.time;
    var parts = getBodyParts(role, maxEnergy)
    //console.log('Spawning new creep:', name);
    return Game.spawns['Spawn1'].spawnCreep(parts, name, {memory: {role: role}});
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
