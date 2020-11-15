const { getEnergyFromContainer } = require('helpers.energy')
const roleUpgrader = require('role.upgrader')
const { numEnemeiesNearby } = require('helpers.proximity')
const { getFullestContainer } = require('helpers.targets')
const roleBuilder = require('role.builder')

var roleHauler = {
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
                    return (structure.structureType == STRUCTURE_EXTENSION ||
                            structure.structureType == STRUCTURE_SPAWN ||
                            structure.structureType == STRUCTURE_TOWER) &&
                            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                }
            });

            if (target) {
                let result = creep.transfer(target, RESOURCE_ENERGY)
                if (result === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});

                    /*
                    // TODO check if on road, if not construct road
                    let objects = creep.pos.look()

                    let roads = _.filter(objects, (object) => {
                        return (
                            (object.type === LOOK_CONSTRUCTION_SITES &&
                                object.constructionSite.structureType === STRUCTURE_ROAD)
                        )
                    })

                    if (!roads || !roads.length) {
                        result = creep.pos.createConstructionSite(STRUCTURE_ROAD)
                        if (result !== OK) {
                            console.log("failed to build road", result, creep.pos)
                        }
                    }
                    */

                    return
                }
			} else {
				roleBuilder.run(creep)
			}

            return
	    } else {
            //getStoredEnergy(creep)
            getEnergyFromContainer(creep)
	    }
	}
};

module.exports = roleHauler;
