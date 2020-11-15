const { getEnergyFromContainer } = require('helpers.energy')
const roleUpgrader = require('role.upgrader')
const { numEnemeiesNearby } = require('helpers.proximity')
const { getFullestContainer } = require('helpers.targets')

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
            let target = getFullestContainer(creep)

            if (target) {
				let result = creep.build(target)
				if (result != OK) {
					// console.log(creep.name, "failed build", result)
				}

                if (result == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, {visualizePathStyle: {stroke: '#ffffff'}});
                }
			} else {
				roleUpgrader.run(creep)
			}
	    } else {
            //getStoredEnergy(creep)
            getEnergyFromContainer(creep)
	    }
	}
};

module.exports = roleHauler;