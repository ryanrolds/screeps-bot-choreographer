const { getEnergy } = require('helpers.energy')
const { waitingRoom } = require('helpers.move')
const roleUpgrader = require('role.upgrader')

var roleBuilder = {
    run: function(creep) {
	    if(creep.memory.working && creep.store[RESOURCE_ENERGY] == 0) {
			creep.memory.working = false;
        }
		
	    if(!creep.memory.working && creep.store.getFreeCapacity() === 0) {
	        creep.memory.working = true;
	    }

	    if(creep.memory.working) {
			var flags = creep.room.find(FIND_FLAGS, {
				filter: (flag) => {
					return flag.name.startsWith("builder")
				}
			});

			let target = null
			if (flags.length) {
				target = flags[0].pos.findClosestByPath(FIND_CONSTRUCTION_SITES)
			} else {
				target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES)
			}

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
			getEnergy(creep)
	    }
	}
};

module.exports = roleBuilder;