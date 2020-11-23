
class Room {
    constructor(room) {
        this.id = room.name
        this.gameObject = room
        this.repairers = []
    }
    tick() {

    }
    getSources() {
        return this.gameObject.find(FIND_SOURCES)
    }
}

module.exports = Room
