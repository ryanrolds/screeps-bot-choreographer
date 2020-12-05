const Room = require('org.room')
const Source = require('org.source')
const Spawner = require('org.spawner')
const OrgBase = require('org.base')
const Topics = require('lib.topics')

const WORKERS = require('constants.creeps')

const { MEMORY_ASSIGN_ROOM, MEMORY_ROLE, MEMORY_COLONY } = require('constants.memory')
const { TOPIC_SPAWN, TOPIC_DEFENDERS, TOPIC_HAUL_TASK } = require('constants.topics')
const { WORKER_CLAIMER, WORKER_DEFENDER } = require('constants.creeps')
const { PRIORITY_CLAIMER, PRIORITY_DEFENDER, PRIORITY_HAULER } = require('constants.priorities')

const MAX_DEFENDERS = 3

class Colony extends OrgBase {
    constructor(parent, colony) {
        super(parent, colony.id)

        this.topics = new Topics()

        this.primaryRoom = colony.primary
        this.desiredRooms = colony.rooms
        this.missingRooms = _.difference(this.desiredRooms,  Object.keys(Game.rooms))
        this.colonyRooms =  _.difference(this.desiredRooms,  this.missingRooms)

        this.rooms = this.colonyRooms.reduce((rooms, id) => {
            if (Game.rooms[id]) {
                rooms.push(new Room(this, Game.rooms[id]))
            }

            return rooms
        }, [])

        this.builds = []

        this.sources = this.rooms.reduce((sources, room) => {
            const roomSources = room.getSources()
            roomSources.forEach((source) => {
                sources.push(new Source(this, source))
            })

            return sources
        }, [])

        this.spawns = this.rooms.reduce((spawns, room) => {
            const roomSpawns = room.getSpawns()
            roomSpawns.forEach((spawn) => {
                spawns.push(new Spawner(this, spawn))
            })

            return spawns
        }, [])

        this.availableSpawns = this.spawns.filter((spawner) => {
            return !spawner.getSpawning()
        })

        this.defenders = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] == WORKER_DEFENDER &&
                creep.memory[MEMORY_COLONY] === this.id
        })

        this.numCreeps = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_COLONY] === this.id
        }).length

        this.numHaulers = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_HAULER_V3 &&
                creep.memory[MEMORY_COLONY] === this.id
        }).length
    }
    getColony() {
        return this
    }
    getRoom() {
        throw new Error("a colony is not a room")
    }
    update() {
        console.log(this)

        this.missingRooms.forEach((roomID) => {
            // TODO check if a claimer is already on its way

            if (this.spawns.length) {
                this.sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, {
                    role: WORKER_CLAIMER,
                    memory: {
                        [MEMORY_ASSIGN_ROOM]: roomID
                    }
                })
            } else {
                // Bootstrapping a new colony requires another colony sending
                // creeps to claim and build a spawner
                this.getParent().sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, {
                    role: WORKER_CLAIMER,
                    memory: {
                        [MEMORY_ASSIGN_ROOM]: roomID
                    }
                })
            }
        })

        this.rooms.forEach((room) => {
            room.update()
        })

        this.sources.forEach((source) => {
            source.update()
        })

        this.spawns.forEach((spawn) => {
            spawn.update()
        })
    }
    process() {
        this.updateStats()

        // Check intra-colony requests for defenders
        let request = this.getNextRequest(TOPIC_DEFENDERS)
        if (request) {
            console.log("DEFENDER REQUEST", JSON.stringify(request))

            let neededDefenders = MAX_DEFENDERS - this.defenders.length
            for (let i = 0; i < neededDefenders; i++) {
                this.sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, request.details )
            }

            // Order existing defenders to the room
            this.defenders.forEach((defender) => {
                defender.memory[MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY_ASSIGN_ROOM]
            })
        }

        const numHaulTasks = this.getTopicLength(TOPIC_HAUL_TASK)
        const desiredHaulers = Math.ceil(numHaulTasks / 2.25)
        if (this.numHaulers < desiredHaulers) {
            this.sendRequest(TOPIC_SPAWN, PRIORITY_HAULER, {
                role: WORKERS.WORKER_HAULER_V3,
                memory: {}
            })
        }

        this.rooms.forEach((room) => {
            room.process()
        })

        this.sources.forEach((source) => {
            source.process()
        })

        this.spawns.forEach((spawn) => {
            spawn.process()
        })
    }
    toString() {
        return `** Colony - ID: ${this.id}, #Rooms: ${this.rooms.length}, #Missing: ${this.missingRooms.length}, ` +
            `#Sources: ${this.sources.length}, #Haulers: ${this.numHaulers}, #Spawners: ${this.spawns.length}, ` +
            `#AvailableSpawners: ${this.availableSpawns.length}, #Defenders: ${this.defenders.length}`
    }
    sendRequest(topic, priority, request) {
        this.topics.addRequest(topic, priority, request)
    }
    getNextRequest(topic) {
        return this.topics.getNextRequest(topic)
    }
    getTopicLength(topic) {
        return this.topics.getLength(topic)
    }
    updateStats() {
        const stats = this.getStats()
        stats.topics = this.topics.getCounts()
    }
}

module.exports = Colony
