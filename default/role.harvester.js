const { getHarvestLocation, resetHarvestTTL, clearAssignment } = require('helpers.energy')
const { waitingRoom } = require('helpers.move')
const { hasEnemeiesNearby } = require('helpers.hostiles')

var roleHarvester = {
    run: function(creep) {
        //console.log(creep.name, "free cap", creep.store.getFreeCapacity())

        if (hasEnemeiesNearby(creep.pos)) {
            
            creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
        }

        if (creep.memory.working && creep.store[RESOURCE_ENERGY] == 0) {
			creep.memory.working = false;
        }
		
	    if (!creep.memory.working && creep.store.getFreeCapacity() == 0) {
	        creep.memory.working = true;
	    }

	    if (creep.memory.working) {
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

            return
        } 
          
        var source = getHarvestLocation(creep)
        let result = creep.harvest(source)
        if (result !== ERR_NOT_IN_RANGE) {
            resetHarvestTTL(creep)
        }       

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, {visualizePathStyle: {stroke: '#ffaa00'}});
        }

        if (result === ERR_NOT_ENOUGH_RESOURCES) {
            clearAssignment(creep)
        }
	}
};

module.exports = roleHarvester;