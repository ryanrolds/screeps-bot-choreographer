export const getNearbyPositions = (pos: RoomPosition, range: number): RoomPosition[] => {
  const positions: RoomPosition[] = [];

  for (let x = pos.x - range; x <= pos.x + range; x++) {
    for (let y = pos.y - range; y <= pos.y + range; y++) {
      if (x < 0 || y < 0 || x > 49 || y > 49) {
        continue;
      }

      try {
        positions.push(new RoomPosition(x, y, pos.roomName));
      } catch (e) {
        console.log(x, y, pos.roomName)
        throw e
      }
    }
  }

  return positions
}
