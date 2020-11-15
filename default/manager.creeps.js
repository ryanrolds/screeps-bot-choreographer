const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleDefender = require('role.defender');
const roleRepairer = require('role.repairer');
const roleHauler = require('role.hauler');

const WORKER_BUILDER = "builder"
const WORKER_HARVESTER = "harvester"
const WORKER_UPGRADER = "upgrader"
const WORKER_DEFENDER = "defender"
const WORKER_REPAIRER = "repairer"
const WORKER_HAULER = "repairer"

const workersMax = {
    [WORKER_HARVESTER]: 10,
    [WORKER_UPGRADER]: 7,
    [WORKER_BUILDER]: 2,
    [WORKER_REPAIRER]: 2,
    [WORKER_HAULER]: 0,
    [WORKER_DEFENDER]: 0,
}

const buildOrder = [WORKER_HARVESTER, WORKER_UPGRADER, WORKER_BUILDER,
    WORKER_REPAIRER, WORKER_HAULER, WORKER_DEFENDER]

const workerRoles = {
    [WORKER_HARVESTER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_BUILDER]: [CARRY, MOVE, WORK, WORK],
    [WORKER_UPGRADER]: [CARRY, CARRY, MOVE, WORK],
    [WORKER_DEFENDER]: [TOUGH, TOUGH, TOUGH, MOVE, RANGED_ATTACK],
    [WORKER_REPAIRER]: [CARRY, MOVE, MOVE, WORK],
    [WORKER_HAULER]: [CARRY, CARRY, CARRY, MOVE],
}

const AUTO_BUILD_UPGRADER_FULL_TICKS = 10

module.exports.spawnSuicide = () => {
    let currentWorkers = _.countBy(Game.creeps, (creep) => {
        return creep.memory.role  
    })

    console.log(JSON.stringify(currentWorkers))

    let maxEnergy = Game.spawns['Spawn1'].room.energyCapacityAvailable
    let currentEnergy = Game.spawns['Spawn1'].room.energyAvailable
    let minEnergy = _.max([400, maxEnergy * 0.8])

    // ====================================
    // Track ticks that the spawner is full and 
    if (!Game.spawns['Spawn1'].memory.fullTicks) {
        Game.spawns['Spawn1'].memory.fullTicks = 0
    }

    if (currentEnergy >= maxEnergy) {  
        Game.spawns['Spawn1'].memory.fullTicks++
    } else {
        Game.spawns['Spawn1'].memory.fullTicks = 0
    }

    if (Game.spawns['Spawn1'].memory.fullTicks >= AUTO_BUILD_UPGRADER_FULL_TICKS) {
        console.log("Auto building upgrader")
        createCreep(WORKER_UPGRADER, currentEnergy)
    }
    // ====================================

    if (!Game.spawns['Spawn1'].spawning && currentEnergy >= minEnergy) {
        for (let i = 0; i < buildOrder.length; i++) {
            let role = buildOrder[i]
            let max = workersMax[role]
            let count = currentWorkers[role] || 0
            if (count < max) {
                createCreep(role, currentEnergy)
                break
            } if (count > max * 1.5) {
                suicideWorker(role)
                break
            }
        }        
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
            roleRepairer.run(creep);
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
    Game.spawns['Spawn1'].spawnCreep(parts, name, {memory: {role: role}});
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