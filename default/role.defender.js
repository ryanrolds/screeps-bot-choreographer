const { getEnergy } = require('helpers.energy')

var roleDefender = {
    run: function(creep) {
        if (creep.store.getFreeCapacity() > 0) {
            getEnergy(creep)
            return
        }

        let hostile = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS)
        if (hostile) {
            if(creep.rangedAttack(hostile) == ERR_NOT_IN_RANGE) {
                creep.moveTo(hostile, {visualizePathStyle: {stroke: '#ffffff'}});
            }
        }
	}
};

module.exports = roleDefender;