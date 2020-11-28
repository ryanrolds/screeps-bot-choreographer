
const OrgBase = require('org.base')
const Link = require('org.link')
const Topics = require('lib.topics')

const { MEMORY_ROLE, MEMORY_ASSIGN_ROOM } = require('constants.memory')
const { TOPIC_SPAWN, TOPIC_DEFENDERS } = require('constants.topics')
const { WORKER_UPGRADER, WORKER_REPAIRER, WORKER_BUILDER, WORKER_DEFENDER } = require('constants.creeps')
const { PRIORITY_UPGRADER, PRIORITY_BUILDER, PRIORITY_REPAIRER,
    PRIORITY_REPAIRER_URGENT, PRIORITY_DEFENDER } = require('constants.priorities')

const MAX_UPGRADERS = 3

class Room extends OrgBase {
    constructor(parent, room) {
        super(parent, room.name)

        this.topics = new Topics()

        this.gameObject = room
        this.claimedByMe = room.controller.my

        this.links = room.find(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_LINK
            }
        }).map((link) => {
            return new Link(this, link)
        })

        // TODO
        this.towers = room.find(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_TOWER
            }
        })

        this.repairers = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] == WORKER_REPAIRER &&
                creep.memory[MEMORY_ASSIGN_ROOM] === room.name
        })

        this.numConstructionSites = room.find(FIND_CONSTRUCTION_SITES).length

        this.builders = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_BUILDER &&
                creep.memory[MEMORY_ASSIGN_ROOM] === room.name
        })

        this.upgraders = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] == WORKER_UPGRADER &&
                creep.memory[MEMORY_ASSIGN_ROOM] === room.name
        })

        this.numHostiles = room.find(FIND_HOSTILE_CREEPS).length

        let maxHits = 0
        let hits = 0
        let numStructures = 0
        room.find(FIND_STRUCTURES).forEach((s) => {
            if (s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART) {
                return
            }

            numStructures++

            if (s.hitsMax > 0 && s.hits > 0) {
                maxHits += s.hitsMax
                hits += s.hits
            }
        })
        let hitsPercentage = 1
        if (maxHits > 0) {
            hitsPercentage = hits / maxHits
        }
        this.hitsPercentage = hitsPercentage
        this.numStructures = numStructures

        this.numRepairers = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_REPAIRER &&
                creep.memory[MEMORY_ASSIGN_ROOM] === room.name
        }).length
    }
    update() {
        console.log(this)

        // Send defender request if hostiles present
        if (this.numHostiles) {
            this.sendRequest(TOPIC_DEFENDERS, PRIORITY_DEFENDER, {
                role: WORKER_DEFENDER,
                memory: {
                    [MEMORY_ASSIGN_ROOM]: this.id
                }
            })
        }

        // Upgrader request
        if (this.claimedByMe && this.upgraders.length < MAX_UPGRADERS) {
            // As we get more upgraders, lower the priority
            let upgraderPriority = PRIORITY_UPGRADER - (this.upgraders.length * 1)

            // TODO this will need to be expanded to support
            // multiple claims
            this.sendRequest(TOPIC_SPAWN, upgraderPriority, {
                role: WORKER_UPGRADER,
                memory: {
                    [MEMORY_ASSIGN_ROOM]: this.id
                }
            })
        }

        // Builder requests
        if (this.builders.length < Math.ceil(this.numConstructionSites / 10)) {
            this.sendRequest(TOPIC_SPAWN, PRIORITY_BUILDER, {
                role: WORKER_BUILDER,
                memory: {
                    [MEMORY_ASSIGN_ROOM]: this.id
                }
            })
        }

        // Repairer requests
        let desiredRepairers = 0
        let repairerPriority = PRIORITY_REPAIRER
        if (this.hitsPercentage < 0.8) {
            desiredRepairers = 1
        }

        if (this.hitsPercentage < 0.6) {
            desiredRepairers = 2
            repairerPriority = PRIORITY_REPAIRER_URGENT
        }

        if (this.numStructures > 0 && this.numRepairers < desiredRepairers) {
            this.sendRequest(TOPIC_SPAWN, repairerPriority, {
                role: WORKER_REPAIRER,
                memory: {
                    [MEMORY_ASSIGN_ROOM]: this.id
                }
            })
        }

        this.links.forEach((link) => {
            link.update()
        })
    }
    process() {
        this.updateStats()

        this.links.forEach((link) => {
            link.process()
        })
    }
    toString() {
        return `---- Room - ID: ${this.id}, #Builders: ${this.builders.length}, ` +
        `#Upgraders: ${this.upgraders.length}, #Hostiles: ${this.numHostiles}, ` +
        `#Towers: ${this.towers.length}, #Sites: ${this.numConstructionSites}, ` +
        `%Hits: ${this.hitsPercentage.toFixed(2)}, #Repairer: ${this.numRepairers}, ` +
        `#Links: ${this.links.length}`
    }
    /*
    // Request handling
    sendRequest(topic, priority, request) {
        console.log(this.parent)
        //if (topic === TOPIC_SPAWN) {
        //    this.parent.addRequest(topic, priority, request)
        //    return
        //}

        console.log(topic, priority, request)
        this.topics.addRequest(topic, priority, request)
    }
    getNextRequest(topic) {
        return this.topics.getNextRequest(topic)
    }
    getTopicLength(topic) {
        return this.topics.getLength(topic)
    }
    */
    getRoom() {
        return this
    }
    getSources() {
        return this.gameObject.find(FIND_SOURCES)
    }
    getSpawns() {
        return this.gameObject.find(FIND_MY_SPAWNS)
    }
    updateStats() {
        const room = this.gameObject

        const roomStats = {}
        roomStats.storageEnergy           = (room.storage ? room.storage.store.energy : 0);
        roomStats.terminalEnergy          = (room.terminal ? room.terminal.store.energy : 0);
        roomStats.energyAvailable         = room.energyAvailable;
        roomStats.energyCapacityAvailable = room.energyCapacityAvailable;
        roomStats.controllerProgress      = room.controller.progress;
        roomStats.controllerProgressTotal = room.controller.progressTotal;
        roomStats.controllerLevel         = room.controller.level;

        const stats = this.getStats()
        stats.rooms[this.id] = roomStats
    }
}

module.exports = Room
