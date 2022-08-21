import {WORKER_EXPLORER} from "../constants/creeps";
import {MEMORY_ASSIGN_ROOM, MEMORY_ROLE} from "../constants/memory";
import {YELLOW_JOURNAL_AGE} from "../managers/scribe";
import {getCreepBase} from "../os/kernel/base";
import {Kernel} from "../os/kernel/kernel";

export const BASE_SECTOR_RADIUS = 4;

type RoomCord = {x: number, y: number};

export function getNextRoomToScout(kernel: Kernel, creep: Creep): string {
  const base = getCreepBase(kernel, creep);
  if (!base) {
    return null;
  }

  // Get rooms considered with the bases range/sector
  const nearbyRooms = getNearbyRooms(base.primary, BASE_SECTOR_RADIUS);
  if (nearbyRooms.length === 0) {
    return null;
  }

  const explorers = kernel.getCreepsManager().getCreeps().
    filter(c => c.memory[MEMORY_ROLE] === WORKER_EXPLORER);
  const assignedRooms = explorers.map((explorer) => explorer.memory[MEMORY_ASSIGN_ROOM] as string);

  // Filter rooms down to stale entries and entries already being scouted
  const staleEntries = nearbyRooms.filter((room) => {
    // filter out rooms that are already being scouted
    if (assignedRooms.includes(room)) {
      return false;
    }

    const roomEntry = kernel.getScribe().getRoomById(room);
    if (!roomEntry) {
      return true;
    }

    return Game.time - roomEntry.lastUpdated > YELLOW_JOURNAL_AGE;
  });

  // If no stale entries, return null
  if (staleEntries.length === 0) {
    return null;
  }

  // Sort by distance from creep
  const sortedBy = _.sortBy(staleEntries, (room) => {
    return Game.map.getRoomLinearDistance(creep.pos.roomName, room);
  });

  return sortedBy[0];
}

export function getNearbyRooms(center: string, distance: number): string[] {
  const rooms: string[] = [];

  const centerStatus = Game.map.getRoomStatus(center);
  const baseCord = getRoomCordFromRoomName(center);
  for (let x = -distance + baseCord.x; x <= distance + baseCord.x; x++) {
    for (let y = -distance + baseCord.y; y <= distance + baseCord.y; y++) {
      const roomName = getRoomNameFromRoomCord({x: x, y: y});
      if (roomName == center) {
        continue;
      }

      // Room must have same status as center/base
      const status = Game.map.getRoomStatus(roomName);
      if (status.status !== centerStatus.status) {
        continue;
      }

      rooms.push(roomName);
    }
  }

  return rooms;
}

export function getRoomNameFromRoomCord(roomCord: RoomCord): string {
  const horizontal = roomCord.x < 0 ? 'W' : 'E';
  const vertical = roomCord.y < 0 ? 'N' : 'S';

  if (horizontal === 'W') {
    roomCord.x += 1;
  }

  if (vertical === 'N') {
    roomCord.y += 1;
  }

  const absX = Math.abs(roomCord.x);
  const absY = Math.abs(roomCord.y);
  return horizontal + absX + vertical + absY;
}

export function getRoomCordFromRoomName(roomName: string): RoomCord {
  // get index of E/W
  const eIndex = roomName.indexOf('E');
  const wIndex = roomName.indexOf('W');
  const horizontal = eIndex > -1 ? eIndex : wIndex;

  // get index of N/S
  const nIndex = roomName.indexOf('N');
  const sIndex = roomName.indexOf('S');
  const vertical = sIndex > -1 ? sIndex : nIndex;

  // get x
  let x = parseInt(roomName.substring(horizontal + 1, vertical), 10);
  if (wIndex > -1) {
    x = -x;
    x -= 1;
  }

  // get y
  let y = parseInt(roomName.substring(vertical + 1, roomName.length), 10);
  if (nIndex > -1) {
    y = -y;
    y -= 1;
  }

  return {x, y};
}
