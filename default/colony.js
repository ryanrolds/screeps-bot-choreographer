const roleBuilderV2 = require("./role.builder.v2")
const { MEMORY_HARVEST, MEMORY_ROLE, MEMORY_WITHDRAW, MEMORY_CLAIM, MEMORY_FLAG,
    MEMORY_ROOM_ASSIGN } = require('helpers.memory')
const { WORKER_HARVESTER, WORKER_MINER, WORKER_HAULER, WORKER_CLAIMER, WORKER_BUILDER,
    WORKER_REMOTE_HARVESTER, WORKER_DEFENDER } = require('manager.creeps')

const state = {
    rooms: {},
    builds: [],
    explore: [],
    hostiles: {},
    sources: {
        energy: {}
    }
}

module.exports.tick = (charter) => {
    const visibleRooms = Object.keys(Game.rooms)
    const desiredRooms = charter.rooms
    const exploreRooms = _.difference(desiredRooms, visibleRooms)

    state.explore = exploreRooms.reduce((rooms, roomID) => {
        const hasExplorer = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_CLAIMER && creep.memory[MEMORY_CLAIM] === roomID
        }).length

        rooms[roomID] = {
            id: roomID,
            hasExplorer,
        }

        return rooms
    }, {})

    state.builds = []
    _.each(Game.flags, (value, key) => {
        if (key.startsWith("build")) {
            const numBuilders = _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                return role === WORKER_BUILDER && creep.memory[MEMORY_FLAG] === key
            }).length

            state.builds.push({
                id: key,
                numBuilders
            })
        }
    })

    visibleRooms.forEach((roomID) => {
        const room = Game.rooms[roomID]
        if (!room) {
            return
        }

        const energySources = room.find(FIND_SOURCES)
        energySources.forEach((source) => {
            const container = source.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_CONTAINER
                }
            })
            const hasContainer = container.length > 0

            let containerID = null
            let numHaulers = 0
            if (hasContainer) {
                containerID = container[0].id
                numHaulers = _.filter(Game.creeps, (creep) => {
                    const role = creep.memory[MEMORY_ROLE]
                    return role && role === WORKER_HAULER &&
                        creep.memory[MEMORY_WITHDRAW] && creep.memory[MEMORY_WITHDRAW] === containerID
                }).length
            }

            const numMiners = _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                return role && (role === WORKER_HARVESTER || role === WORKER_REMOTE_HARVESTER ||
                    role === WORKER_MINER) &&
                    creep.memory[MEMORY_HARVEST] && creep.memory[MEMORY_HARVEST] === source.id
            }).length

            state.sources.energy[source.id] = {
                id: source.id,
                roomID: roomID,
                containerID,
                numMiners,
                numHaulers
            }
        })

        const numDefenders = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_DEFENDER &&
                creep.memory[MEMORY_ROOM_ASSIGN] === creep.room.name
        }).length

        state.rooms[room.name] = {
            id: room.name,
            numDefenders
        }
    })

    return state
}
