const topEdge = 1;
const bottomEdge = 48;
const leftEdge = 1;
const rightEdge = 48;
const blockingObjects: Record<string, boolean> = {
  [STRUCTURE_WALL]: true,
  [STRUCTURE_RAMPART]: true,
};

export type RegionMap = Record<string, Position>;
export type Position = {x: number, y: number};

export function getRegion(room: Room, starting: RoomPosition): RegionMap {
  const regionMap: RegionMap = {};

  if (isWallOrInRegion(room, regionMap, starting)) {
    return regionMap;
  }

  const stack: Position[] = [{x: starting.x, y: starting.y}];
  while (stack.length) {
    let pos = stack.pop();
    // Move position to top/edge
    while (pos.y - 1 >= topEdge && !isWallOrInRegion(room, regionMap, {x: pos.x, y: pos.y - 1})) {
      pos.y--;
    }

    let reachLeft = false;
    let reachRight = false;

    while (pos.y <= bottomEdge && !isWallOrInRegion(room, regionMap, pos)) {
      regionMap[[pos.x, pos.y].join(',')] = {x: pos.x, y: pos.y};

      if (pos.x >= leftEdge) {
        if (!isWallOrInRegion(room, regionMap, {x: pos.x - 1, y: pos.y})) {
          if (!reachLeft) {
            stack.push({x: pos.x - 1, y: pos.y});
            reachLeft = true;
          }
        } else {
          reachLeft = false;
        }
      }

      if (pos.x <= rightEdge) {
        if (!isWallOrInRegion(room, regionMap, {x: pos.x + 1, y: pos.y})) {
          if (!reachRight) {
            stack.push({x: pos.x + 1, y: pos.y});
            reachRight = true;
          }
        } else {
          reachRight = false;
        }
      }

      pos.y++;
    }
  }

  return regionMap;
}

function isWallOrInRegion(room: Room, regionMap: RegionMap, pos: Position): boolean {
  if (regionMap[[pos.x, pos.y].join(',')]) {
    return true;
  }

  const objects = room.lookAt(pos.x, pos.y);
  return !!_.find(objects, (object) => {
    if (object.type === LOOK_STRUCTURES) {
      return blockingObjects[object.structure.structureType];
    }

    return false;
  });
}
