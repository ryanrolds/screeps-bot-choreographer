const roleBuilderV2 = require("./role.builder.v2")
const { MEMORY_HARVEST, MEMORY_ROLE, MEMORY_WITHDRAW, MEMORY_CLAIM } = require('helpers.memory')
const { WORKER_HARVESTER, WORKER_HAULER, WORKER_CLAIMER, WORKER_REMOTE_HARVESTER } = require('manager.creeps')

const state = {
    rooms: {

    },
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
        const numExplorers = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] && creep.memory[MEMORY_ROLE] === WORKER_CLAIMER &&
                creep.memory[MEMORY_CLAIM] && creep.memory[MEMORY_CLAIM] === roomID
        }).length

        let room = {
            id: roomID,
            hasExplorer: numExplorers > 0
        }
        rooms[roomID] = room
        return rooms
    }, {})

    visibleRooms.forEach((roomID) => {
        const room = Game.rooms[roomID]
        if (!room) {
            return
        }

        const energySources = room.find(FIND_SOURCES)
        energySources.forEach((source) => {
            const container = source.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (structure) => {
                    return structure.structureType = STRUCTURE_CONTAINER
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
                return role && (role === WORKER_HARVESTER || role === WORKER_REMOTE_HARVESTER) &&
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

        state.rooms[room.name] = {
            id: room.name,
        }
    })

    return state
}
