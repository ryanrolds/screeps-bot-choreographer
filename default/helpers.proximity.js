module.exports.numEnemeiesNearby = (pos, distance = 5) => {
  return numXNearby(pos, FIND_HOSTILE_CREEPS, distance);
};

module.exports.numMyCreepsNearby = (pos, distance = 5) => {
  return numXNearby(pos, FIND_MY_CREEPS, distance);
};

module.exports.numOfSourceSpots = (source) => {
  const pos = source.pos;
  return source.room.lookForAtArea(LOOK_TERRAIN, pos.y - 1, pos.x - 1, pos.y + 1, pos.x + 1, true)
    .filter((o) => o.terrain !== 'wall').length;
};

const numXNearby = (pos, find, distance = 5) => {
  const found = pos.findInRange(find, distance);
  if (!found) {
    return 0;
  }

  return found.length;
};
