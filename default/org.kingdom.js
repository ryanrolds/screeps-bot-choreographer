const OrgBase = require('org.base')
const Colony = require('org.colony')
const WarParty = require('org.warparty')
const ResourceGovernor = require('org.resource_governor')
const Topics = require('lib.topics')
const tracing = require('lib.tracing')

const helpersCreeps = require('helpers.creeps')
const MEMORY = require('constants.memory')
const { MEMORY_DROPOFF } = require('constants.memory')

class Kingdom extends OrgBase {
    constructor(colonies) {
        super(null, 'kingdom')

        this.topics = new Topics()
        this.stats = {
            rooms: {}, // DEPRECATED, use colonies
            colonies: {},
            sources: {},
            spawns: {}
        }

        this.colonies = Object.values(colonies).map((colony) => {
            return new Colony(this, colony)
        })

        this.warParties = Object.values(Game.flags).reduce((parties, flag) => {
            if (flag.name.startsWith("attack")) {
                parties[flag.name] = new WarParty(this, flag)
            }

            return parties
        }, {})


        this.resourceGovernor = new ResourceGovernor(this)
    }
    update() {
        console.log(this)

        Object.values(this.warParties).forEach((party) => {
            party.update()
        })

        Object.values(this.colonies).forEach((colony) => {
            colony.update()
        })


        this.resourceGovernor.update()
    }
    process() {
        Object.values(this.warParties).forEach((party) => {
            party.process()
        })

        Object.values(this.colonies).forEach((colony) => {
            colony.process()
        })

        this.resourceGovernor.process()

        let creepsTrace = tracing.startTrace("creeps")
        helpersCreeps.tick(this, creepsTrace)
        creepsTrace.end()

        this.updateStats()

        // Set stats in memory for pulling and display in Grafana
        Memory.stats = this.getStats()
    }
    toString() {
        return `---- Kingdom - #Colonies: ${this.colonies.length}`
    }
    // Request handling
    sendRequest(topic, priority, request) {
        this.topics.addRequest(topic, priority, request)
    }
    getNextRequest(topic) {
        let request = this.topics.getNextRequest(topic)
        return request
    }
    peekNextRequest(topic) {
        return this.topics.peekNextRequest(topic)
    }
    getTopicLength(topic) {
        return this.topics.getLength(topic)
    }
    getKingdom() {
        return this
    }
    getColonies() {
        return this.colonies
    }
    getColony() {
        throw new Error("a kingdom is not a colony")
    }
    getColonyById(colonyId) {
        return _.find(this.colonies, {id: colonyId})
    }
    getRoom() {
        throw new Error("a kingdom is not a room")
    }
    getCreepRoom(creep) {
        const colony = this.getCreepColony(creep)
        if (!colony) {
            return null
        }

        const roomId = creep.room.name
        return colony.getRoomByID(roomId)
    }
    getCreepColony(creep) {
        const colonyId = creep.memory[MEMORY.MEMORY_COLONY]
        if (!colonyId) {
            return null
        }

        return this.getColonyById(colonyId)
    }
    getReserveResources() {
        return this.colonies.reduce((acc, colony) => {
            const colonyResources = colony.getReserveResources()
            Object.keys(colonyResources).forEach((resource) => {
                let current = acc[resource] || 0
                acc[resource] = colonyResources[resource] + current
            })

            return acc
        }, {})
    }
    getAmountInReserve(resource) {
        return this.colonies.reduce((acc, colony) => {
            return acc + colony.getAmountInReserve(resource)
        }, 0)
        return this.primaryRoom.getAmountInReserve(resource)
    }
    getStats() {
        return this.stats
    }
    updateStats() {
        const stats = this.getStats()

        stats.time = Game.time

        // Collect GCL stats
        stats.gcl = {}
        stats.gcl.progress      = Game.gcl.progress;
        stats.gcl.progressTotal = Game.gcl.progressTotal;
        stats.gcl.level         = Game.gcl.level;

        // Collect CPU stats
        stats.cpu = {}
        stats.cpu.bucket        = Game.cpu.bucket;
        stats.cpu.limit         = Game.cpu.limit;
        stats.cpu.used          = Game.cpu.getUsed();

        stats.creeps = _.countBy(Game.creeps, (creep) => {
            return creep.memory.role
        })

        stats.resources = this.getReserveResources()
    }
}

module.exports = Kingdom
