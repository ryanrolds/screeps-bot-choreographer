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

        const spawnTopicSize = this.getTopicLength(TOPIC_SPAWN)
        const spawnTopicBackPressure = Math.floor(this.energyCapacity * (1 - (0.09 * spawnTopicSize)))
        let energyLimit = _.max([300, spawnTopicBackPressure])

        let minEnergy = 300
        const numCreeps = this.getColony().numCreeps
        if (this.energyCapacity > 800) {
            if (numCreeps > 50) {
                minEnergy = this.energyCapacity * 0.90
            } else if (numCreeps > 30) {
                minEnergy = this.energyCapacity * 0.80
            } else if (numCreeps > 20) {
                minEnergy = this.energyCapacity * 0.60
            } else if (numCreeps > 10) {
                minEnergy = 500
            }
        }
        minEnergy = _.min([minEnergy, spawnTopicBackPressure])

        console.log(this.energy, this.energyCapacity, minEnergy, energyLimit, spawnTopicBackPressure, numCreeps, spawnTopicSize)

        if (!this.isIdle) {
            this.gameObject.room.visual.text(
                this.gameObject.spawning.name + '🛠️',
                Game.spawns['Spawn1'].pos.x - 1,
                Game.spawns['Spawn1'].pos.y,
                {align: 'right', opacity: 0.8});

            this.gameObject.memory['ticksIdle'] = 0
            return
        }

        if (this.energy >= minEnergy) {
            console.log(this.id, "have enough energy to build")

            let request = this.getNextRequest(TOPIC_SPAWN)
            if (request) {
                console.log("BUILDING", this.id, JSON.stringify(request))
                let result = this.createCreep(request.details.role, request.details.memory, energyLimit)
                return
            }

            console.log(this.id, "home colony does not need anything")

            // Check inter-colony requests if the colony has spawns
            request = this.getKingdom().getNextRequest(TOPIC_SPAWN)
            if (request) {
                console.log("KINGDOM BUILDING", JSON.stringify(request))
                let result = this.createCreep(request.details.role, request.details.memory, energyLimit)
                return
            }
        }

        // Track how long we sit without something to do (no requests or no energy)
        this.gameObject.memory['ticksIdle']++
    }
    createCreep(role, memory, energyLimit) {
        let energy = this.energy
        return creepHelpers.createCreepV2(this.getColony().id, this.roomId, this.gameObject,
            role, memory, energy, energyLimit)
    }
    getSpawning() {
        return this.gameObject.spawning
    }
    toString() {
        return `---- Spawner - ID: ${this.id}, Idle: ${this.isIdle}, Energy: ${this.energy}, `+
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
