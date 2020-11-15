const { getEnergyFromSource, getStoredEnergy } = require('helpers.energy')
const { numEnemeiesNearby } = require('helpers.proximity')

var roleUpgrader = {
    run: function(creep) {
        // Not getting near enemies imparative
        if (numEnemeiesNearby(creep.pos)) {
            console.log("enemy spotted returning home", creep.name)
            creep.moveTo(waitingRoom(creep), {visualizePathStyle: {stroke: '#ffffff'}});
            return
        }

        if(creep.memory.working && creep.store[RESOURCE_ENERGY] == 0) {
            creep.memory.working = false;
            creep.say('🔄 withdraw');
        }
        
	    if(!creep.memory.working && creep.store.getFreeCapacity() < 50) {
	        creep.memory.working = true;
	        creep.say('⚡ upgrade');
	    }

	    if(creep.memory.working) {
            if(creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: '#ffffff'}});
            }
        }
        else {
            if (Game.spawns['Spawn1'].memory.energyAvailable) {
                getStoredEnergy(creep)
            } else {
                getEnergyFromSource(creep)
            }
        }
	}
};

module.exports = roleUpgrader;