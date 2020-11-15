const { waitingRoom } = require('helpers.move')
const { numMyCreepsNearby, numEnemeiesNearby } = require('helpers.proximity')
const { getEnergyStorageTargets, getEnergySource, getEnergyContainerTargets } = require('helpers.targets')

const DEFAULT_TTL = 75

module.exports.getStoredEnergy = (creep) => {
    const sources = getEnergyStorageTargets(creep)
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

module.exports.getEnergyFromSource = (creep) => {
    const source = getEnergySource(creep)
    if (!source) {
        creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
        return
    }

    let result = creep.harvest(source)
    if (result != OK) {
        //console.log(creep.name, "failed withdrawl", result)
    }

    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, {visualizePathStyle: {stroke: '#ffaa00'}});
    }

    return

}

module.exports.getEnergyFromContainer = (creep) => {
    const source = getEnergyContainerTargets(creep)
    if (!sources) {
        creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
        return
    }

    let result = creep.withdraw(source, RESOURCE_ENERGY)

    console.log(result)

    if (result != OK) {
        //console.log(creep.name, "failed withdrawl", result)
    }

    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, {visualizePathStyle: {stroke: '#ffaa00'}});
    }

    return

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

    var sources = creep.room.find(FIND_SOURCES)

    sources = _.filter(sources, (source) => {
        // Do not send creeps to sources with hostiles near by
        return numEnemeiesNearby(source.pos, 5) < 1
    })

    // Sort by the number of creeps by the source
    sources = _.sortBy(sources, (source) => {
        return numMyCreepsNearby(source.pos, 8)
    })

    // TODO factor in distance

    // Get first item on the array
    let source = sources[0]

    // Assign candidate to creep
    creep.memory.source = source.id
    // Use TTL to tell if creep cant harvest in reasonable time
    // If the TTL hits 0 then we get a new assignment
    creep.memory.ttl = DEFAULT_TTL

    console.log("assigning", creep.name, source)

    return source
}

module.exports.resetHarvestTTL = (creep) => {
    creep.memory.ttl = DEFAULT_TTL
    //console.log("reset ttl", creep.name)
}

module.exports.clearAssignment = (creep) => {
    creep.memory.source = null
}
