const roleBuilder = require('role.builder')
const { numEnemeiesNearby } = require('helpers.proximity')
const { getStoredEnergy, getEnergyFromSource } = require('helpers.energy')

const WALL_LEVEL = 1000

var roleRepairer = {
    run: function(creep) {
        // Not getting near enemies imparative
        if (numEnemeiesNearby(creep.pos)) {
            console.log("enemy spotted returning home", creep.name)
            creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
            return
        }

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
            
            if (target) {
                let result = creep.repair(target)
                console.log(result)
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
            if (Game.spawns['Spawn1'].memory.energyAvailable &&
                Game.spawns['Spawn1'].room.energyAvailable > 100) {
                getStoredEnergy(creep)
            } else {
                getEnergyFromSource(creep)
            }
	    }
	}
};

module.exports = roleRepairer;