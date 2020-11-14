const { waitingRoom } = require('helpers.move')
const { numMyCreepsNearby, numEnemeiesNearby } = require('helpers.proximity')
const { getEnergyTargets } = require('helpers.targets')

const DEFAULT_TTL = 75

module.exports.getEnergy = (creep) => {
    const sources = getEnergyTargets(creep)
    if (sources.length > 0) {
        let result = creep.withdraw(sources[0], RESOURCE_ENERGY)
        if (result != OK) {
            //console.log(creep.name, "failed withdrawl", result)
        }

        if(result === ERR_NOT_IN_RANGE) {
            creep.moveTo(sources[0], {visualizePathStyle: {stroke: '#ffaa00'}});
        }

        return
    }
    
    creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});		
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
        // console.log("ttl update", creep.name,  creep.memory.ttl, Game.time)   

        // Don't count ticks where the creep didn't move
        if (creep.fatigue === 0) {
            creep.memory.ttl = creep.memory.ttl - 1
        }        
                
        // If TTL is still good then return source
        if (creep.memory.ttl > 0) {
            return Game.getObjectById(creep.memory.source)
        }

        // TTL expired path, should get new assignment
        console.log("ttl hit for", creep.name)
    }

    // Candidate tracking vars
    var assigned = null
    var assignedCount = 99999

    var sources = creep.room.find(FIND_SOURCES)
    sources.forEach((source) => {
        // Do not send creeps to sources with hostiles near by
        if (numEnemeiesNearby(source.pos, 5)) {
            return
        }

        // Get num of my creeps near the source and use as candidate if fewer
        // then the current candidate
        let numCreepsNearSource = numMyCreepsNearby(source.pos, 8)
        if (numCreepsNearSource < assignedCount) {
            assignedCount = numCreepsNearSource
            assigned = source
        }
    })

    // Assign candidate to creep
    creep.memory.source = assigned.id
    creep.memory.ttl = DEFAULT_TTL

    console.log("assigning", creep.name, assigned, assignedCount)

    return assigned
}