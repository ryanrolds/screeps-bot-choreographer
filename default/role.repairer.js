const { getEnergy } = require('helpers.energy')
const roleBuilder = require('role.builder')

const WALL_LEVEL = 1000

var roleRepairer = {
    run: function(creep) {
	    if(creep.memory.working && creep.store[RESOURCE_ENERGY] == 0) {
			creep.memory.working = false;
        }
		
	    if(!creep.memory.working && creep.store.getFreeCapacity() === 0) {
	        creep.memory.working = true;
	    }

	    if(creep.memory.working) {
			var target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (
						(structure.hits < structure.hitsMax && structure.structureType != STRUCTURE_WALL) ||
						(structure.hits < WALL_LEVEL && structure.structureType === STRUCTURE_WALL)
					)
                }
            });
			
            if(target) {
				let result = creep.repair(target)
				if (result != OK) {
					// console.log(creep.name, "failed repair", result)
				}

                if(result == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
			} else {
				roleBuilder.run(creep)
			}
	    } else {
			getEnergy(creep)
	    }
	}
};

module.exports = roleRepairer;