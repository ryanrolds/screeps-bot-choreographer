const { numEnemeiesNearby } = require('helpers.proximity')

module.exports.getEnergyStorageTargets = (creep) => {
    return creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (
                (structure.structureType == STRUCTURE_EXTENSION && structure.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) ||
                (structure.structureType == STRUCTURE_SPAWN && structure.store.getUsedCapacity(RESOURCE_ENERGY) >= 300)
            )
        }
    })
}

module.exports.getEnergySource = (creep) => {
    var sources = creep.room.find(FIND_SOURCES, {
        filter: (source) => {
            if (numEnemeiesNearby(source.pos, 5)) {
                return false
            }

            return true
        }
    })

    if (!sources || !sources.length) {
        return null
    }

    return sources[0]
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