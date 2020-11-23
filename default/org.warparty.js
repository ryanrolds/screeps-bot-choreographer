const { MEMORY_FLAG } = require('constants.memory')

class WarParty {
    constructor(flag) {
        this.name = flag.name
        this.room = flag.room.name
        this.creeps = Object.values(Game.creeps).reduce((creeps, creep) => {
            if (creep.memory[MEMORY_FLAG] === this.name) {
                creeps.push(creep)
            }

            return creeps
        }, [])
    }
    tick() {
        console.log(this)
    }
    toString() {
        return `---- War Party - #Creeps: ${this.creeps.length}`
    }
}

module.exports = WarParty
