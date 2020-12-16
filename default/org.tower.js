const OrgBase = require('org.base')

const MEMORY = require('constants.memory')
const TASKS = require('constants.tasks')
const CREEPS = require('constants.creeps')
const TOPICS = require('constants.topics')

const MAX_DEFENSE_HITS = 120000

class Tower extends OrgBase {
    constructor(parent, tower) {
        super(parent, tower.id)

        this.gameObject = tower

        this.energy = tower.energy

        this.haulersWithTask = _.filter(Game.creeps, (creep) => {
            const task = creep.memory[MEMORY.MEMORY_TASK_TYPE]
            const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF]

            return task === TASKS.TASK_HAUL && dropoff === this.id
        })

        this.haulerUsedCapacity = _.reduce(this.haulersWithTask, (total, hauler) => {
            return total += hauler.store.getUsedCapacity()
        }, 0)

        // TODO port tower logic over
    }
    update() {
        console.log(this)
    }
    process() {
        let tower = this.gameObject

        if (tower.energy + this.haulerUsedCapacity < 500) {
            const pickupId = this.parent.getClosestStoreWithEnergy(tower)

            const priority = 1 - ((tower.energy + this.haulerUsedCapacity) /
                tower.store.getCapacity(RESOURCE_ENERGY))

            const details = {
                [MEMORY.MEMORY_TASK_TYPE]:  TASKS.HAUL_TASK,
                [MEMORY.MEMORY_HAUL_PICKUP]: pickupId,
                [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
                [MEMORY.MEMORY_HAUL_DROPOFF]: tower.id
            }

            this.sendRequest(TOPICS.TOPIC_HAUL_TASK, priority, details)
        }

        var hostiles = this.parent.getHostiles()
        if (hostiles && hostiles.length) {

            hostiles = _.sortBy(hostiles, (hostile) => {
                return hostile.getActiveBodyparts(HEAL)
            }).reverse()

            tower.attack(hostiles[0])
            return
        }

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
    }
    toString() {
        return `---- Tower - ID: ${this.id}, Energy: ${this.energy}`
    }
}

module.exports = Tower
