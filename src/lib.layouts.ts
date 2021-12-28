
export const EMPTY = 'empty';
export const ANY = 'any';

export const buildingCodes = {
  'X': EMPTY,
  '.': ANY,
  'R': STRUCTURE_ROAD,
  'P': STRUCTURE_SPAWN,
  'E': STRUCTURE_EXTENSION,
  'C': STRUCTURE_CONTAINER,
  'T': STRUCTURE_TOWER,
  'S': STRUCTURE_STORAGE,
  'L': STRUCTURE_LINK,
  'M': STRUCTURE_TERMINAL,
  'B': STRUCTURE_LAB,
  'O': STRUCTURE_OBSERVER,
  'N': STRUCTURE_NUKER,
}

export type Layout = {
  origin: {x: number, y: number};
  buildings: string[][];
}


export const getConstructionPosition = (pos: {x: number, y: number}, origin: RoomPosition,
  layout: Layout): RoomPosition => {
  return new RoomPosition(pos.x + origin.x - layout.origin.x, pos.y + origin.y - layout.origin.y, origin.roomName);
}
