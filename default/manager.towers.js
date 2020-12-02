
const MAX_DEFENSE_HITS = 120000

module.exports.tick = () => {
    _.forEach(Game.rooms, (room) => {
        const towers = room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_TOWER});

        var hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles && hostiles.length) {

            hostiles = _.sortBy(hostiles, (hostile) => {
                return hostile.getActiveBodyparts(HEAL)
            }).reverse()

            towers.forEach(tower => tower.attack(hostiles[0]));
            return
        }

        towers.forEach((tower) => {
            for (let name in Game.creeps) {
                // get the creep object
                var creep = Game.creeps[name];
                if (creep.hits < creep.hitsMax && creep.room.name === tower.room.name) {
                    tower.heal(creep)
                    return
                }
            }

            if (tower.energy > 250) {
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
                            s.structureType == STRUCTURE_WALL) &&
                            s.hits < MAX_DEFENSE_HITS // TODO this needs to scale with energy reserves
                    }
                })
                damagedSecondaryStructures = _.sortBy(damagedSecondaryStructures, (structure) => {
                    return structure.hits
                })
                if (damagedSecondaryStructures && damagedSecondaryStructures.length) {
                    tower.repair(damagedSecondaryStructures[0]);
                    return
                }

                var damagedRoads = tower.room.find(FIND_STRUCTURES, {
                    filter: (s) => {
                        return s.hits < s.hitsMax && s.structureType == STRUCTURE_ROAD
                    }
                })
                damagedRoads = _.sortBy(damagedRoads, (structure) => {
                    return structure.hits
                })
                if (damagedRoads && damagedRoads.length) {
                    tower.repair(damagedRoads[0]);
                    return
                }
            }
        })
    })
}
