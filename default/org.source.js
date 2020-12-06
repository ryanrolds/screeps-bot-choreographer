const OrgBase = require('org.base')

const MEMORY = require('constants.memory')
const TASKS = require('constants.tasks')
const CREEPS = require('constants.creeps')
const TOPICS = require('constants.topics')

const { TOPIC_SPAWN } = require('constants.topics')
const { WORKER_HAULER, WORKER_REMOTE_HARVESTER, WORKER_MINER,
    WORKER_HARVESTER, WORKER_REMOTE_MINER, WORKER_REMOTE_HAULER } = require('constants.creeps')
const { PRIORITY_HARVESTER, PRIORITY_MINER, PRIORITY_HAULER, PRIORITY_REMOTE_HAULER,
    PRIORITY_REMOTE_MINER } = require('constants.priorities')

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

        const container = source.pos.findClosestByRange(containers)

        this.container = null
        this.containerID = null
        this.containerUser = null
        this.numHaulers = 0

        if (container) {
            this.container = container
            this.containerID = container.id

            this.numHaulers =  _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY.MEMORY_ROLE]
                return (role === WORKER_HAULER || role === WORKER_REMOTE_HAULER) &&
                    creep.memory[MEMORY.MEMORY_WITHDRAW] === this.container.id &&
                    creep.ticksToLive > 100
            }).length

            this.containerUsed = this.container.store.getUsedCapacity()
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

        this.haulersWithTask = _.filter(Game.creeps, (creep) => {
            const task = creep.memory[MEMORY.MEMORY_TASK_TYPE]
            const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP]

            // do not count creeps that have already picked up a load
            if (creep.store.getUsedCapacity() > 0) {
                return false
            }

            return task === TASKS.TASK_HAUL && pickup === this.containerID
        })

        this.haulerCapacity = _.reduce(this.haulersWithTask, (total, hauler) => {
            return total += hauler.store.getFreeCapacity()
        }, 0)

        const colonyId = this.getColony().id
        this.colonyCreeps = _.filter(Game.creeps,  {memory: {[MEMORY.MEMORY_COLONY]: colonyId}})
        this.haulers = _.filter(this.colonyCreeps, {memory: {[MEMORY.MEMORY_ROLE]: CREEPS.WORKER_HAULER_V3}})
        this.avgHaulerCapacity = _.reduce(this.haulers, (total, hauler) => {
            return total + hauler.store.getCapacity()
        }, 0) / this.haulers.length
    }
    update() {
        console.log(this)

        this.sendHaulTasks()

        let desiredHarvesters = 3
        let desiredMiners = 0
        let desiredHaulers = 0

        // If there is a container, we want a miner and a hauler
        if (this.container) {
            desiredHarvesters = 0
            desiredMiners = 1
            desiredHaulers = 1

            // Hauling adjacent rooms requires additional haulers
            if (!this.gameObject.room.controller.my) {
                desiredHaulers++
            }

            // If container is full, request an additional hauler
            if (this.container & this.container.store.getFreeCapacity() < 500) {
                desiredHaulers++
            }
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
            let priority = PRIORITY_MINER

            // Energy sources in unowned rooms require half as many parts
            if (!this.gameObject.room.controller.my) {
                role = WORKER_REMOTE_MINER
                priority = PRIORITY_REMOTE_MINER
            }

            this.sendRequest(TOPIC_SPAWN, priority, {
                role: role,
                memory: {
                    [MEMORY.MEMORY_HARVEST]: this.id,
                    [MEMORY.MEMORY_HARVEST_CONTAINER]: this.containerID,
                    [MEMORY.MEMORY_HARVEST_ROOM]: this.roomID
                }
            })
        }

        /*
        if (this.numHaulers < desiredHaulers) {
            let priority = PRIORITY_HAULER
            let role = WORKER_HAULER
            if (!this.gameObject.room.controller.my) {
                priority = PRIORITY_REMOTE_HAULER
                role = WORKER_REMOTE_HAULER
            }

            this.sendRequest(TOPIC_SPAWN, priority, {
                role,
                memory: {
                    [MEMORY.MEMORY_WITHDRAW]: this.container.id,
                    [MEMORY.MEMORY_WITHDRAW_ROOM]: this.roomID
                }
            })
        }
        */
    }
    process() {
        this.updateStats()
    }
    toString() {
        return `---- Source - ${this.id}, #Harvesters: ${this.numHarvesters}, #Miners: ${this.numMiners}, ` +
            `#Haulers: ${this.numHaulers}, Container: ${this.containerID}, #HaulerWithTask: ${this.haulersWithTask.length}, ` +
            `SumHaulerTaskCapacity: ${this.haulerCapacity}, UsedCapacity: ${this.containerUsed}`
    }
    updateStats() {
        const source = this.gameObject

        const stats = this.getStats()
        const sourceStats = {
            energy: source.energy,
            capacity: source.energyCapacity,
            regen: source.ticksToRegeneration,
            containerFree: (this.container != null) ? this.container.store.getFreeCapacity() : null
        }

        stats.colonies[this.getColony().id].rooms[this.roomID].sources[this.id] = sourceStats
    }
    sendHaulTasks() {
        if (!this.container) {
            return
        }

        const averageLoad = this.avgHaulerCapacity || 300
        const storeCapacity = this.container.store.getCapacity()
        const storeUsedCapacity = this.container.store.getUsedCapacity()
        const untaskedUsedCapacity = storeUsedCapacity - this.haulerCapacity
        const loadsToHaul = Math.ceil(untaskedUsedCapacity / averageLoad)

        for (let i = 0; i < loadsToHaul; i++) {
            const loadPriority = (untaskedUsedCapacity - (i * averageLoad)) / storeCapacity

            const details = {
                [MEMORY.MEMORY_TASK_TYPE]:  TASKS.HAUL_TASK,
                [MEMORY.MEMORY_HAUL_PICKUP]: this.container.id,
                [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY
            }

            this.sendRequest(TOPICS.TOPIC_HAUL_TASK, loadPriority, details)
        }
    }
}

module.exports = Source
