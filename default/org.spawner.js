const OrgBase = require('org.base');

const { MEMORY_ROLE, MEMORY_ASSIGN_ROOM } = require('constants.memory');
const { WORKER_DISTRIBUTOR, WORKER_ATTACKER } = require('constants.creeps');
const { TOPIC_SPAWN } = require('constants.topics')
const { PRIORITY_DISTRIBUTOR } = require('constants.priorities');

const creepHelpers = require('helpers.creeps')

const MIN_DISTRIBUTORS = 2

class Spawner extends OrgBase {
    constructor(parent, spawner) {
        super(parent, spawner.id)

        this.roomId = spawner.room.name
        this.gameObject = spawner
        spawner.memory['ticksIdle'] = 0

        this.isIdle = !spawner.spawning
        this.energy = spawner.room.energyAvailable
        this.energyCapacity = spawner.room.energyCapacityAvailable
        this.energyPercentage = this.energy / this.energyCapacity

        this.hasStorage = spawner.pos.findInRange(FIND_STRUCTURES, 8, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_CONTAINER ||
                    structure.structureType == STRUCTURE_STORAGE);
            }
        }).length > 0

        this.numDistributors = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR &&
                creep.memory[MEMORY_ASSIGN_ROOM] === spawner.room.name
        }).length
    }
    update() {
        console.log(this)

        // Send a request if we are short on distributors
        if (this.hasStorage && this.numDistributors < MIN_DISTRIBUTORS) {
            this.sendRequest(TOPIC_SPAWN, PRIORITY_DISTRIBUTOR, {
                role: WORKER_DISTRIBUTOR,
                memory: {
                    [MEMORY_ASSIGN_ROOM]: this.roomId
                }
            })
        }
    }
    process() {
        this.updateStats()

        if (!this.isIdle) {
            this.gameObject.room.visual.text(
                this.gameObject.spawning.name + '🛠️',
                Game.spawns['Spawn1'].pos.x - 1,
                Game.spawns['Spawn1'].pos.y,
                {align: 'right', opacity: 0.8});

            this.gameObject.memory['ticksIdle'] = 0
            return
        }

        let request = this.getNextRequest(TOPIC_SPAWN)
        if (request) {
            console.log("BUILDING", JSON.stringify(request))
            this.createCreep(request.details.role, request.details.memory)
            return
        }

        // Track how long we sit without something to do (no requests or no energy)
        this.gameObject.Memory['ticksIdle']++
    }
    createCreep(role, memory) {
        let energyLimit = this.energyCapacity * 0.6
        if (role === WORKER_ATTACKER) {
            energyLimit = this.energyCapacity
        }

        creepHelpers.createCreepV2(this.getColony(), this.roomId, role, memory, energyLimit)
        //creepHelpers.createCreep(role, energyLimit, memory)
    }
    getSpawning() {
        return this.gameObject.spawning
    }
    toString() {
        return `---- Spawner - ID: ${this.id}, Idle: ${this.isIdle}, `+
            `%Energy: ${this.energyPercentage.toFixed(2)}, hasStorage: ${this.hasStorage}, `+
            `#Distributors: ${this.numDistributors}`
    }
    updateStats() {
        const spawn = this.gameObject

        const stats = this.getStats()
        stats.spawns[this.id] = {
            ticksIdle: spawn.memory['ticksIdle']
        }
    }
}

module.exports = Spawner
