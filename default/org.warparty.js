const OrgBase = require('org.base')

const { MEMORY_ROLE, MEMORY_ASSIGN_ROOM, MEMORY_FLAG } = require('constants.memory')
const { TOPIC_SPAWN } = require('constants.topics')
const { WORKER_ATTACKER } = require('constants.creeps')
const { PRIORITY_ATTACKER } = require('constants.priorities')

const MIN_ATTACKERS = 3

class WarParty extends OrgBase {
    constructor(parent, flag) {
        super(parent, flag.name)

        this.roomId = flag.room && flag.room.name || 'unknown'
        this.creeps = Object.values(Game.creeps).reduce((creeps, creep) => {
            if (creep.memory[MEMORY_FLAG] === this.id) {
                creeps.push(creep)
            }

            return creeps
        }, [])
    }
    update() {
        console.log(this)
        
        if (this.creeps.length < MIN_ATTACKERS) {
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
