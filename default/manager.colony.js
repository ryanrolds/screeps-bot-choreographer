const { MEMORY_HARVEST, MEMORY_ROLE, MEMORY_WITHDRAW, MEMORY_CLAIM, MEMORY_FLAG,
    MEMORY_ASSIGN_ROOM } = require('constants.memory')
const { WORKER_HARVESTER, WORKER_MINER, WORKER_HAULER, WORKER_CLAIMER, WORKER_BUILDER,
    WORKER_REMOTE_HARVESTER, WORKER_DEFENDER, WORKER_REPAIRER, WORKER_ATTACKER } = require('constants.creeps')

const state = {
    rooms: {},
    builds: [],
    explore: [],
    hostiles: {},
    sources: {
        energy: {}
    },
    warParties: {}
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

            // If a flag is in a room we don't have visibility, the room property is undefined
            let hasSites = false
            let numSites = 0
            let flagRoom = null
            let accessible = false
            if (Game.flags[key].room) {
                accessible = true
                flagRoom = Game.flags[key].room
                numSites = flagRoom.find(FIND_CONSTRUCTION_SITES).length
                hasSites = numSites > 0
            }

            let build = {
                id: key,
                accessible,
                numBuilders,
                numSites,
                hasSites
            }

            console.log("==== Build:", JSON.stringify(build))

            state.builds.push(build)
        }

        if (key.startsWith("attack")) {
            const numAttackers = _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                return role === WORKER_ATTACKER && creep.memory[MEMORY_FLAG] === key
            }).length

            let warParty = {
                id: key,
                numAttackers
            }

            console.log("==== War Party:", JSON.stringify(warParty))

            state.warParties[warParty.id] = warParty
      }
    })

    visibleRooms.forEach((roomID) => {
        const room = Game.rooms[roomID]
        if (!room || desiredRooms.indexOf(roomID) === -1) {
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
            let containerUsed = 0
            let numHaulers = 0
            if (hasContainer) {
                containerID = container[0].id
                containerUsed = container[0].store.getUsedCapacity()
                numHaulers = _.filter(Game.creeps, (creep) => {
                    const role = creep.memory[MEMORY_ROLE]
                    return role && role === WORKER_HAULER &&
                        creep.memory[MEMORY_WITHDRAW] && creep.memory[MEMORY_WITHDRAW] === containerID
                }).length
            }

            const numHarvesters = _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                return (role === WORKER_HARVESTER || role === WORKER_REMOTE_HARVESTER) &&
                    creep.memory[MEMORY_HARVEST] === source.id
            }).length

            const numMiners = _.filter(Game.creeps, (creep) => {
                const role = creep.memory[MEMORY_ROLE]
                return role === WORKER_MINER && creep.memory[MEMORY_HARVEST] === source.id
            }).length

            state.sources.energy[source.id] = {
                id: source.id,
                roomID: roomID,
                numHarvesters,
                numMiners,
                numHaulers,
                energyPercent: (source.energy / source.energyCapacity * 100).toFixed(2),
                regenPercent: (source.ticksToRegeneration / 300 * 100).toFixed(2),
                capacity: source.energyCapacity,
                containerID,
                containerUsed
            }
        })

        const numDefenders = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_DEFENDER &&
                creep.memory[MEMORY_ASSIGN_ROOM] === creep.room.name
        }).length

        let maxHits = 0
        let hits = 0
        room.find(FIND_STRUCTURES).forEach((s) => {
            if (s.structureType == STRUCTURE_WALL || s.structureType == STRUCTURE_RAMPART) {
                return
            }

            if (s.hitsMax > 0 && s.hits > 0) {
                maxHits += s.hitsMax
                hits += s.hits
            }
        })

        const hasPrimaryStructures = room.find(FIND_STRUCTURES, {
            filter: (s) => {
                return s.hits < s.hitsMax && (
                    s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART &&
                    s.structureType != STRUCTURE_ROAD)
            }
        }).length > 0

        const hasSecondaryStructures = room.find(FIND_STRUCTURES, {
            filter: (s) => {
                return s.hits < s.hitsMax && (
                    s.structureType == STRUCTURE_RAMPART ||
                    s.structureType == STRUCTURE_ROAD ||
                    s.structureType == STRUCTURE_WALL
                )
            }
        }).length > 0

        const hasStructures = hasPrimaryStructures || hasSecondaryStructures

        const numRepairers = _.filter(Game.creeps, (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_REPAIRER &&
                creep.memory[MEMORY_ASSIGN_ROOM] === room.name
        }).length

        let hitsPercentage = 1
        if (maxHits > 0) {
            hitsPercentage = hits / maxHits
        }

        state.rooms[room.name] = {
            id: room.name,
            numDefenders,
            hasStructures,
            numRepairers,
            hitsPercentage
        }

        console.log("==== Room:", JSON.stringify(state.rooms[room.name]))
    })

    _.each(state.sources.energy, (source) => {
        console.log("==== Source:", JSON.stringify(source))
    })

    return state
}
