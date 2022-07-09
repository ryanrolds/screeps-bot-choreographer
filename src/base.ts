import {MEMORY_BASE} from "./constants.memory";
import {Kernel} from "./kernel";
import {LabsByAction, ResourceCounts} from "./runnable.base_booster";
import {BaseLayout} from "./runnable.base_construction";

const PER_LEVEL_ENERGY = 100000;

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
  const baseId = creep.memory[MEMORY_BASE];
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

export function getStoredResources(base: Base): ResourceCounts {
  return getStorageStructures(base).reduce((acc, structure) => {
    Object.keys(structure.store).forEach((resource: ResourceConstant) => {
      const current = acc[resource] || 0;
      acc[resource] = structure.store.getUsedCapacity(resource) + current;
    });

    return acc;
  }, {} as ResourceCounts);
}

export function getStoredResourceAmount(base: Base, resource: ResourceConstant): number {
  const resources = getStoredResources(base);
  return resources[resource] || 0;
}

export function getEnergyFullness(base: Base): number {
  const structures = getStorageStructures(base)
  if (!structures.length) {
    return 0;
  }

  const stores = structures.reduce((acc, structure) => {
    acc.capacity += structure.store.getCapacity(RESOURCE_ENERGY);
    acc.used += structure.store.getUsedCapacity(RESOURCE_ENERGY);
    return acc;
  }, {capacity: 0, used: 0});

  if (!stores.capacity) {
    return 0;
  }

  return stores.used / stores.capacity;
}

export function getReserveBuffer(base: Base): number {
  if (!this.room.controller?.my) {
    return 0;
  }

  const roomLevel = this.getRoomLevel();

  if (roomLevel < 4) {
    return 2000;
  }

  return (roomLevel - 3) * PER_LEVEL_ENERGY;
}

export function getStorageStructures(base: Base): StructureStorage[] {
  const structures = [];

  if (!this.room) {
    return structures;
  }

  if (this.room.storage?.isActive()) {
    structures.push(this.room.storage);
  }

  if (this.room.terminal?.isActive()) {
    structures.push(this.room.terminal);
  }

  return structures;
}

export function getStructureWithResource(base: Base, resource: ResourceConstant): AnyStoreStructure | null {
  const structures = getStructuresWithResource(base, resource);
  if (!structures.length) {
    return null;
  }

  return structures[0];
}

export function getStructureForResource(base: Base, resource: ResourceConstant): AnyStoreStructure | null {
  const structures = getStructuresForResource(base, resource);
  if (!structures.length) {
    return null;
  }

  return structures[0];
}

export function getStructuresWithResource(base: Base, resource: ResourceConstant): AnyStoreStructure[] {
  const structures: AnyStoreStructure[] = [];

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

export function getStructuresForResource(base: Base, resource: ResourceConstant): AnyStoreStructure[] {
  const structures: AnyStoreStructure[] = [];

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

export function getBaseLevelCompleted(base: Base) {
  const room = getBasePrimaryRoom(base);
  if (!room) {
    return 0
  }

  if (!room.controller?.my) {
    return 0;
  }

  return room.controller.progress / room.controller.progressTotal;
}

export function getDamagedStructures(base: Base): Structure[] {
  const structures: Structure[] = [];

  // @REFACTOR decide how to share damaged structures

  return structures;
}

export function getNextDamagedStructure(base: Base): Structure | null {
  const structures = getDamagedStructures(base);
  if (!structures.length) {
    return null;
  }

  return structures[0];
}

export function baseEnergyStorageCapacity(base: Base): number {
  const room = getBasePrimaryRoom(base);
  if (!room) {
    return 0;
  }

  return room.energyCapacityAvailable || 0;
}
