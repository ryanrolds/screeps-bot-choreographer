import {baseLayouts} from "../base/construction";
import {MAX_PARTY_SIZE} from "../creeps/party/party";
import {Base, getBaseLevel} from "../os/kernel/base";
import {DIRECTION_OFFSET} from "./position";

export type Vector = {pos: RoomPosition, direction: DirectionConstant, magnitude: number};
export type MusterPoint = {x: number, y: number, direction: DirectionConstant};

// get muster point for a party to form up on
export function getMusterVector(base: Base): Vector {
  const level = getBaseLevel(base);
  const musterPoints = baseLayouts[level].muster;

  // check muster points until we find one that is not obstructed
  for (let i = 0; i < musterPoints.length; i++) {
    const point = musterPoints[i];
    for (let j = 0; j < MAX_PARTY_SIZE; j++) {
      const origin = base.origin;

      const x = origin.x + point.x + DIRECTION_OFFSET[point.direction].x * j;
      const y = origin.y + point.y + DIRECTION_OFFSET[point.direction].y * j;
      const pos = new RoomPosition(x, y, base.primary);

      // if structure is present, skip this muster point
      if (pos.lookFor(LOOK_STRUCTURES).length) {
        continue;
      }

      // if construction site is present, skip this muster point
      if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length) {
        continue;
      }

      // if wall is present, skip this muster point
      const roomTerrain = Game.rooms[base.primary].getTerrain();
      if (roomTerrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }
    }

    const x = base.origin.x + point.x;
    const y = base.origin.y + point.y;

    return {
      pos: new RoomPosition(x, y, base.primary),
      direction: point.direction,
      magnitude: MAX_PARTY_SIZE,
    };
  }

  return null;
}
