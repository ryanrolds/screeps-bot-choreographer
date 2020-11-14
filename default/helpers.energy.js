const { waitingRoom } = require('helpers.move')
const { hasEnemeiesNearby } = require('helpers.hostiles')

const DEFAULT_TTL = 75

module.exports.getEnergy = (creep) => {
    var sources = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (
                (structure.structureType == STRUCTURE_EXTENSION && structure.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) ||
                (structure.structureType == STRUCTURE_SPAWN && structure.store.getUsedCapacity(RESOURCE_ENERGY) >= 300)
            )
        }
    })

    if (sources.length > 0) {
        let result = creep.withdraw(sources[0], RESOURCE_ENERGY)
        if (result != OK) {
            //console.log(creep.name, "failed withdrawl", result)
        }

        if(result === ERR_NOT_IN_RANGE) {
            creep.moveTo(sources[0], {visualizePathStyle: {stroke: '#ffaa00'}});
        }
    } else {
        creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
    }		
}

const saturationBox = 5

module.exports.resetHarvestTTL = (creep) => {
    creep.memory.ttl = DEFAULT_TTL
    //console.log("reset ttl", creep.name)
}

module.exports.clearAssignment = (creep) => {
    creep.memory.source = null
}

module.exports.getHarvestLocation = (creep) => {
    if (creep.memory.source) {
        if (creep.fatigue === 0) {
            creep.memory.ttl = creep.memory.ttl - 1
        }
 
        // console.log("ttl update", creep.name,  creep.memory.ttl, Game.time)

        if (creep.memory.ttl > 0) {
            return Game.getObjectById(creep.memory.source)
        }

        console.log("ttl hit for", creep.name)
    }

    var assigned = null
    var assignedCount = 99999

    var sources = creep.room.find(FIND_SOURCES)
    sources.forEach((source) => {
        if (hasEnemeiesNearby(source.pos)) {
            return
        }

        if (found.length < assignedCount) {
            assignedCount = found.length
            assigned = source
        }
    })

    creep.memory.source = assigned.id
    creep.memory.ttl = DEFAULT_TTL

    console.log("assigning", creep.name, assigned, assignedCount)

    return assigned
}