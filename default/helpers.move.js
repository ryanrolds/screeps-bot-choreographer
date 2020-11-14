module.exports.waitingRoom = (creep) => {
    let pos = Game.spawns['Spawn1'].pos
    return creep.room.getPositionAt(pos.x - 5, pos.y)
}