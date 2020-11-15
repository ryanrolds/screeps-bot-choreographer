const { numEnemeiesNearby } = require('helpers.proximity')

module.exports.getEnergyStorageTargets = (creep) => {
    return creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (
                (structure.structureType == STRUCTURE_EXTENSION) ||
                (structure.structureType == STRUCTURE_SPAWN)
            )
        }
    })
}

module.exports.getEnergySource = (creep) => {
    var sources = creep.room.find(FIND_SOURCES, {
        filter: (source) => {
            // Don't send creeps to enemy covered soruces
            if (numEnemeiesNearby(source.pos, 5)) {
                return false
            }

            // Don't send creeps to low energy sources
            if (source.energy < 100) {
                return false
            }

            return true
        }
    })

    sources = _.sortBy(sources, (source) => {
        let result = PathFinder.search(creep.pos, {pos: source.pos})
        if (result.incomplete) {
            return 99999
        }      

        return result.cost
    })

    if (!sources || !sources.length) {
        return null
    }

    return sources.pop()
}

module.exports.getFullestContainer = (creep) => {
    var containers = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTAINER &&
                structure.store.getUsedCapacity() > 0            
        }
    })

    containers = _.sortBy(containers, (container) => {
        return container.store.getUsedCapacity()
    })

    return container[0]
}