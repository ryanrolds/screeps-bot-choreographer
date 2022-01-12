export const getNearbyPositions = (pos: RoomPosition, range: number): RoomPosition[] => {
  const positions: RoomPosition[] = [];

  for (let x = pos.x - range; x <= pos.x + range; x++) {
    for (let y = pos.y - range; y <= pos.y + range; y++) {
      if (x < 1 && y < 1 && x > 48 && y > 48) {
        continue;
      }

      positions.push(new RoomPosition(x, y, pos.roomName));
    }
  }

  return positions
}
