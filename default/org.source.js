const OrgBase = require('org.base')

const MEMORY = require('constants.memory')
const { TOPIC_SPAWN } = require('constants.topics')
const { WORKER_HAULER, WORKER_REMOTE_HARVESTER, WORKER_MINER,
    WORKER_HARVESTER, WORKER_REMOTE_MINER } = require('constants.creeps')
const { PRIORITY_HARVESTER, PRIORITY_MINER, PRIORITY_HAULER } = require('constants.priorities')

class Source extends OrgBase {
    constructor(parent, source) {
        super(parent, source.id)

        this.gameObject = source
        this.roomID = source.room.name

        const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_CONTAINER
            }
        })

        this.container = null
        this.containerID = null
        this.numHaulers = 0

        if (containers.length) {
            this.container = containers[0]
            this.containerID = containers[0].id

            this.numHaulers =  _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY.MEMORY_ROLE]
                return role === WORKER_HAULER &&
                    creep.memory[MEMORY.MEMORY_WITHDRAW] === this.container.id &&
                    creep.ticksToLive > 100
            }).length
        }

        this.numHarvesters = _.filter(Game.creeps, (creep) => {
            const role = creep.memory[MEMORY.MEMORY_ROLE]
            return (role === WORKER_HARVESTER || role === WORKER_REMOTE_HARVESTER) &&
                creep.memory[MEMORY.MEMORY_HARVEST] === this.id &&
                creep.ticksToLive > 100
        }).length

        this.numMiners = _.filter(Game.creeps, (creep) => {
            const role = creep.memory[MEMORY.MEMORY_ROLE]
            return (role === WORKER_MINER || role === WORKER_REMOTE_MINER) &&
                creep.memory[MEMORY.MEMORY_HARVEST] === this.id &&
                creep.ticksToLive > 100
        }).length
    }
    update() {
        console.log(this)

        let desiredHarvesters = 3
        let desiredMiners = 0
        let desiredHaulers = 0

        // If there is a container, we want a miner and a hauler
        if (this.container) {
            desiredHarvesters = 0
            desiredMiners = 1
            desiredHaulers = 1

            // Hauling adjacent rooms requires additional haulers
            //if (!this.gameObject.room.controller.my) {
            //    desiredHaulers++
            //}
        }

        if (this.numHarvesters < desiredHarvesters) {
            // As we get more harvesters, make sure other creeps get a chance to spawn
            let priority = PRIORITY_HARVESTER - (this.numHarvesters * 1.5)
            this.sendRequest(TOPIC_SPAWN, priority, {
                role: WORKER_REMOTE_HARVESTER,
                memory: {
                    [MEMORY.MEMORY_HARVEST]: this.id,
                    [MEMORY.MEMORY_HARVEST_ROOM]: this.roomID
                }
            })
        }

        if (this.numMiners < desiredMiners) {
            let role = WORKER_MINER

            // Energy sources in unowned rooms require half as many parts
            if (!this.gameObject.room.controller.my) {
                role = WORKER_REMOTE_MINER
            }

            this.sendRequest(TOPIC_SPAWN, PRIORITY_MINER, {
                role: role,
                memory: {
                    [MEMORY.MEMORY_HARVEST]: this.id,
                    [MEMORY.MEMORY_HARVEST_ROOM]: this.roomID
                }
            })
        }

        if (this.numHaulers < desiredHaulers) {
            this.sendRequest(TOPIC_SPAWN, PRIORITY_HAULER, {
                role: WORKER_HAULER,
                memory: {
                    [MEMORY.MEMORY_WITHDRAW]: this.container.id,
                    [MEMORY.MEMORY_WITHDRAW_ROOM]: this.roomID
                }
            })
        }
    }
    process() {
        this.updateStats()
    }
    toString() {
        return `---- Source - ${this.id}, #Harvesters: ${this.numHarvesters}, #Miners: ${this.numMiners}, ` +
            `#Haulers: ${this.numHaulers}, Container: ${this.containerID}`
    }
    updateStats() {
        const source = this.gameObject

        const stats = this.getStats()
        stats.sources[this.id] = {
            energy: source.energy,
            capacity: source.energyCapacity,
            regen: source.ticksToRegeneration,
            containerFree: (this.container != null) ? this.container.store.getFreeCapacity() : null
        }
    }
}

module.exports = Source
