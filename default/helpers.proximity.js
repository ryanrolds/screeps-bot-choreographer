module.exports.numEnemeiesNearby = (pos, distance = 5) => {
    return numXNearby(pos, FIND_HOSTILE_CREEPS, distance)
}

module.exports.numMyCreepsNearby = (pos, distance = 5) => {
    return numXNearby(pos, FIND_MY_CREEPS, distance)
}

const numXNearby = (pos, find, distance = 5) => {
    let found = pos.findInRange(find, distance)
    if (!found) {
        return 0
    }

    return found.length
}
