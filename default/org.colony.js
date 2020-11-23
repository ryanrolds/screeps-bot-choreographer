const Room = require('org.room')
const Source = require('./org.source')

class Colony {
    constructor(colony) {
        this.id = colony.id
        this.desiredRooms = colony.rooms
        this.missingRooms = _.difference(this.desiredRooms,  Object.keys(Game.rooms))
        this.colonyRooms =  _.difference(this.desiredRooms,  this.missingRooms)

        this.rooms = this.colonyRooms.reduce((rooms, id) => {
            if (Game.rooms[id]) {
                rooms.push(new Room(Game.rooms[id]))
            }

            return rooms
        }, [])

        this.builds = []

        this.sources = this.rooms.reduce((sources, room) => {
            const roomSources = room.getSources()
            roomSources.forEach((source) => {
                sources.push(new Source(source))
            })

            return sources
        }, [])

        this.defenders = []
    }
    tick() {
        console.log(this)

        this.rooms.forEach((room) => {
            room.tick()
        })

        this.sources.forEach((source) => {
            source.tick()
        })

        this.defenders.forEach((defender) => {
            defender.tick()
        })
    }
    toString() {
        return `---- Colony - ID: ${this.id}, #Rooms: ${this.rooms.length}, #Missing: ${this.missingRooms.length}, ` +
            `#Sources: ${this.sources.length}`
    }
}

module.exports = Colony
