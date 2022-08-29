import {RoomEntry} from '../managers/scribe';

const MIN_HEALING_BOOST_AMOUNT = 2000;

export function scoreRoomDamage(room: RoomEntry): number {
  let towerDamage = room.numTowers * 600;

  // if no storage or low energy, try to run the room out of energy
  if (!room.storage || room.storage.energy < 10000) {
    towerDamage = room.numTowers * 150;
  }

  return towerDamage + room.hostilesDmg;
}

export function scoreStorageHealing(storage: StructureStorage): number {
  const healing2x = storage.store.getUsedCapacity(RESOURCE_LEMERGIUM_OXIDE) > MIN_HEALING_BOOST_AMOUNT;
  const healing3x = storage.store.getUsedCapacity(RESOURCE_LEMERGIUM_ALKALIDE) > MIN_HEALING_BOOST_AMOUNT;
  const healing4x = storage.store.getUsedCapacity(RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE) > MIN_HEALING_BOOST_AMOUNT;

  if (healing4x) {
    return 4;
  }

  if (healing3x) {
    return 3;
  }

  if (healing2x) {
    return 2;
  }

  return 1;
}
