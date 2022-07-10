import {Base} from './base';

export function getReserveStructures(
  game: Game,
  base: Base,
  includeTerminal: boolean,
): AnyStoreStructure[] {
  const reserveStructures = [];

  const room = game.rooms[base.primary];
  if (!room) {
    return reserveStructures;
  }

  if (room.storage?.isActive()) {
    reserveStructures.push(this.room.storage);
  }

  if (includeTerminal && room.terminal?.isActive()) {
    reserveStructures.push(room.terminal);
  }

  return reserveStructures;
}

export function getReserveStructureWithRoomForResource(
  game: Game,
  base: Base,
  resource: ResourceConstant,
): AnyStoreStructure | undefined {
  let structures = getReserveStructures(game, base, false);
  if (!structures.length) {
    return null;
  }

  structures = _.sortBy(structures, (structure) => {
    return structure.store.getFreeCapacity(resource) || 0;
  }).reverse();

  return structures[0];
}
