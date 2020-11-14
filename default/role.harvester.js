const { getHarvestLocation, resetHarvestTTL, clearAssignment } = require('helpers.energy')
const { waitingRoom } = require('helpers.move')
const { numEnemeiesNearby } = require('helpers.proximity')

var roleHarvester = {
    run: function(creep) {
        //console.log(creep.name, "free cap", creep.store.getFreeCapacity())

        // Not getting near enemies imparative
        if (numEnemeiesNearby(creep.pos)) {
            console.log("enemy spotted returning home", creep.name)
            creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
        }

        // Stop hualing when empty
        if (creep.memory.hualing && creep.store[RESOURCE_ENERGY] == 0) {
			creep.memory.hualing = false;
        }
        
        // Start hualing when energy is full
	    if (!creep.memory.hualing && creep.store.getFreeCapacity() == 0) {
	        creep.memory.hualing = true;
	    }

        // Haul energy to nearest storage and dump it
	    if (creep.memory.hualing) { 
            var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_EXTENSION ||
                            structure.structureType == STRUCTURE_SPAWN ||
                            structure.structureType == STRUCTURE_TOWER) && 
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                }
            });
    
            if (!target) {
                target = waitingRoom(creep)
            } 
    
            let result = creep.transfer(target, RESOURCE_ENERGY)
            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
            } 

            // TODO check if on road, if not construct road

            return
        } 

        // Not hauling, be gathering energy          
        var source = getHarvestLocation(creep)

        let result = creep.harvest(source)
        // If we are in range reset the assignment TTL
        if (result !== ERR_NOT_IN_RANGE) {
            resetHarvestTTL(creep)
        }       

        // If not in rage, move toward the node
        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, {visualizePathStyle: {stroke: '#ffaa00'}});
        }

        // Find new node if this node is tapped
        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            clearAssignment(creep)
        }
	}
};

module.exports = roleHarvester;