import {RoomEntry} from "./runnable.scribe";

const MIN_HEALING_BOOST_AMOUNT = 2000;

export function scoreRoomDamage(room: RoomEntry): number {
  return room.numTowers * 600 + room.hostilesDmg;
}

export function scoreStorageHealing(storage: StructureStorage): number {
  let healing2x = storage.store.getUsedCapacity(RESOURCE_LEMERGIUM_OXIDE) > MIN_HEALING_BOOST_AMOUNT;
  let healing3x = storage.store.getUsedCapacity(RESOURCE_LEMERGIUM_ALKALIDE) > MIN_HEALING_BOOST_AMOUNT;
  let healing4x = storage.store.getUsedCapacity(RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE) > MIN_HEALING_BOOST_AMOUNT;

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
