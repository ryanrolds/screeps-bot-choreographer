module.exports.tick = (charter) => {
    charter.rooms.forEach((roomId) => {
        const room = Game.rooms[roomId]
        if (!room) {
            return
        }

        const towers = room.find(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_TOWER});

        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles && hostiles.length) {
            towers.forEach(tower => tower.attack(hostiles[0]));
            return
        }

        towers.forEach((tower) => {
            for (let name in Game.creeps) {
                // get the creep object
                var creep = Game.creeps[name];
                if (creep.hits < creep.hitsMax) {
                    tower.heal(creep)
                    return
                }
            }

            if(tower.energy > 250) {
                var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (s) => {
                        return s.hits < s.hitsMax && (
                            s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART &&
                            s.structureType != STRUCTURE_ROAD)

                    }
                });
                if (closestDamagedStructure) {
                    tower.repair(closestDamagedStructure);
                    return
                }

                var damagedSecondaryStructures = tower.room.find(FIND_STRUCTURES, {
                    filter: (s) => {
                        return s.hits < s.hitsMax && (
                            s.structureType == STRUCTURE_RAMPART ||
                            s.structureType == STRUCTURE_ROAD ||
                            s.structureType == STRUCTURE_WALL
                        )
                    }
                })
                damagedSecondaryStructures = _.sortBy(damagedSecondaryStructures, (structure) => {
                    return structure.hits
                })
                if (damagedSecondaryStructures && damagedSecondaryStructures.length) {
                    tower.repair(damagedSecondaryStructures[0]);
                    return
                }
            }
        })
    })
}
