import {Kernel} from "./kernel";
import {LabsByAction, ResourceCounts} from "./runnable.base_booster";
import {BaseLayout} from "./runnable.base_construction";

export enum AlertLevel {
  GREEN = "green",
  YELLOW = "yellow",
  RED = "red",
};

export interface BaseMap {
  [id: string]: Base;
}

export interface Base {
  id: NonNullable<string>;
  primary: NonNullable<string>;
  rooms: NonNullable<string[]>;
  origin: NonNullable<RoomPosition>;
  parking: RoomPosition;
  isPublic: NonNullable<boolean>;
  walls: NonNullable<{x: number, y: number}[]>;
  passages: NonNullable<{x: number, y: number}[]>;
  neighbors: NonNullable<string[]>;
  alertLevel: NonNullable<AlertLevel>;

  boostPosition: RoomPosition; // TODO refactor lab arrangement to be more flexible and efficient
  boosts: NonNullable<{[action: string]: StructureLab[]}>;
}

export function getBasePrimaryRoom(base: Base): Room {
  return Game.rooms[base.primary];
}

export function getCreepBase(kernel: Kernel, creep: Creep): Base {
  const baseId = creep.memory[MEMORY.MEMORY_BASE];
  if (!baseId) {
    return null;
  }

  const base = kernel.getPlanner().getBaseById(baseId);
  if (!base) {
    return null;
  }

  return base;
}

export function setParking(base: Base, layout: BaseLayout, origin: RoomPosition): void {
  base.parking = new RoomPosition(layout.parking.x + origin.x, layout.parking.y + origin.y,
    origin.roomName);
}

export function getBoostPosition(base: Base): RoomPosition {
  return base.boostPosition;
}

export function setBoostPosition(base: Base, pos: RoomPosition) {
  base.boostPosition = pos;
}

export function getLabsForAction(base: Base, action: string): StructureLab[] {
  if (!base.boosts[action]) {
    return [];
  }

  return base.boosts[action];
}

export function setLabsByAction(base: Base, labsByAction: LabsByAction) {
  base.boosts = labsByAction;
}

export function getResources(kernel: Kernel, base: Base): ResourceCounts {
  const resources = {};

  return resources;
}

export function getStructureWithResource(base: Base, resource: ResourceConstant): Structure | null {
  const structures = getStructuresWithResource(base, resource);
  if (!structures.length) {
    return null;
  }

  return structures[0];
}

export function getStructureForResource(base: Base, resource: ResourceConstant): Structure | null {
  const structures = getStructuresForResource(base, resource);
  if (!structures.length) {
    return null;
  }

  return structures[0];
}

export function getStructuresWithResource(base: Base, resource: ResourceConstant): Structure[] {
  const structures: Structure[] = [];

  const room = getBasePrimaryRoom(base);
  if (!room) {
    return null;
  }

  if (room.storage?.store.getUsedCapacity(resource) > 0) {
    structures.push(room.storage);
  }

  if (room.terminal?.store.getUsedCapacity(resource) > 0) {
    structures.push(room.terminal);
  }

  return structures;
}

export function getStructuresForResource(base: Base, resource: ResourceConstant): Structure[] {
  const structures: Structure[] = [];

  const room = getBasePrimaryRoom(base);
  if (!room) {
    return null;
  }

  if (room.storage?.store.getFreeCapacity() > 0) {
    structures.push(room.storage);
  }

  if (room.terminal?.store.getFreeCapacity() > 0) {
    structures.push(room.terminal);
  }

  return structures;
}

export function getBaseSpawns(base: Base): StructureSpawn[] {
  const spawns: StructureSpawn[] = [];

  return spawns;
}

export function getBaseLevel(base: Base): number {
  let level = 0;

  const room = getBasePrimaryRoom(base);
  if (!room) {
    return level
  }

  if (room.controller?.level) {
    level = room.controller.level;
  }

  return level;
}
