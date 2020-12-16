const OrgBase = require('org.base')

const MEMORY = require('constants.memory')
const WORKERS = require('constants.creeps')

const { MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_FLAG } = require('constants.memory')
const { TOPIC_SPAWN } = require('constants.topics')
const { WORKER_ATTACKER } = require('constants.creeps')
const { PRIORITY_ATTACKER } = require('constants.priorities')
const { MEMORY_DROPOFF } = require('./constants.memory')

const NUM_ATTACKERS = 4

const FORMATION = [
    {x: -1, y: 1 },
    {x: 0, y: 1 },
    {x: -1, y: 0 },
    {x: 0, y: 0 }
]

class WarParty extends OrgBase {
    constructor(parent, flag) {
        super(parent, flag.name)

        this.flag = flag
        this.roomId = flag.room && flag.room.name || 'unknown'
        this.creeps = Object.values(Game.creeps).reduce((creeps, creep) => {
            if (creep.memory[MEMORY_FLAG] === this.id) {
                creeps.push(creep)
            }

            return creeps
        }, [])

        this.sortedHealth = _.sortBy(this.creeps.filter((creep) => {
            return creep.hits < creep.hitsMax
        }), (creep) => {
            return creep.hits / creep.hitsMax
        })

        this.nearbyHostile = null
        this.nearbyEnemyStructure = null

        if (flag.room) {
            console.log("health", JSON.stringify(this.sortedHealth))

            this.nearbyHostile = flag.pos.findClosestByRange(FIND_HOSTILE_CREEPS, 3)

            console.log("hostiles", JSON.stringify(this.nearbyHostile))

            this.nearbyEnemyStructure = flag.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, 3)

            console.log("structures", JSON.stringify(this.nearbyEnemyStructure))

            this.nearbyWall = flag.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_WALL
                }
            })

            console.log("wall", JSON.stringify(this.nearbyWall))
        }
    }
    update() {
        console.log(this)

        this.creeps.forEach((creep, idx) => {
            if (this.nearbyHostile) {
                creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyHostile.id
            } else if (this.nearbyEnemyStructure) {
                creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyEnemyStructure.id
            } else if (!creep.room.controller.my && this.nearbyWall) {
                creep.memory[MEMORY.MEMORY_ATTACK] = this.nearbyWall.id
            } else {
                creep.memory[MEMORY.MEMORY_ATTACK] = null
            }

            if (this.sortedHealth.length) {
                creep.memory[MEMORY.MEMORY_HEAL] = this.sortedHealth[0].id
            } else {
                creep.memory[MEMORY.MEMORY_HEAL] = null
            }

            const x = this.flag.pos.x + FORMATION[idx].x
            const y = this.flag.pos.y + FORMATION[idx].y
            creep.memory[MEMORY.MEMORY_POSITION_X] = x
            creep.memory[MEMORY.MEMORY_POSITION_Y] = y
            creep.memory[MEMORY.MEMORY_POSITION_ROOM] =  this.flag.pos.roomName
        })

        // Request more creeps
        if (this.creeps.length < NUM_ATTACKERS) {
            this.sendRequest(TOPIC_SPAWN, PRIORITY_ATTACKER, {
                role: WORKER_ATTACKER,
                memory: {
                    [MEMORY_FLAG]: this.id
                }
            })
        }
    }
    process() {
        // TODO consume alarms and respond
    }
    toString() {
        return `---- War Party - ID: ${this.id}, Room: ${this.roomId}, #Creeps: ${this.creeps.length}`
    }
}

module.exports = WarParty
