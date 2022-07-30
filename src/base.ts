import {MEMORY_BASE} from './constants.memory';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {EffectSet, LabsByAction} from './runnable.base_booster';
import {BaseLayout} from './runnable.base_construction';
import {TerminalTask} from './runnable.base_terminal';

const PER_LEVEL_ENERGY = 100000;

export enum AlertLevel {
  GREEN = 'green',
  YELLOW = 'yellow',
  RED = 'red',
}

export interface Base {
  id: NonNullable<string>;

  primary: NonNullable<string>;
  rooms: NonNullable<string[]>;

  origin: NonNullable<RoomPosition>;
  parking: RoomPosition;

  walls: NonNullable<{x: number, y: number}[]>;
  passages: NonNullable<{x: number, y: number}[]>;
  neighbors: NonNullable<string[]>;
  alertLevel: NonNullable<AlertLevel>;
  isPublic: NonNullable<boolean>;

  boostPosition: RoomPosition; // TODO refactor lab arrangement to be more flexible and efficient
  boosts: NonNullable<LabsByAction>;
  storedEffects: EffectSet;
  labsByAction: LabsByAction;

  terminalTask: TerminalTask;

  damagedStructures: Id<AnyStructure>[];
  defenseHitsLimit: number;
  damagedSecondaryStructures: Id<AnyStructure>[];
}

export type ResourceCounts = Map<ResourceConstant, number>;

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
  if (!base.boosts.has(action)) {
    return [];
  }

  return base.boosts.get(action);
}

export function setLabsByAction(base: Base, labsByAction: LabsByAction) {
  base.boosts = labsByAction;
}

export function getStoredResources(base: Base): ResourceCounts {
  return getStorageStructures(base).reduce((acc, structure) => {
    Object.keys(structure.store).forEach((resource: ResourceConstant) => {
      const current = acc.get(resource) || 0;
      acc.set(resource, structure.store.getUsedCapacity(resource) + current);
    });

    return acc;
  }, new Map());
}

export function getStoredResourceAmount(base: Base, resource: ResourceConstant): number {
  const resources = getStoredResources(base);
  return resources.get(resource) || 0;
}

export function getEnergyFullness(base: Base): number {
  const structures = getStorageStructures(base);
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
  const room = getBasePrimaryRoom(base);
  if (!room) {
    return 0
  }

  if (!room.controller?.my) {
    return 0;
  }

  const roomLevel = getBaseLevel(base);
  if (roomLevel < 4) {
    return 2000;
  }

  return (roomLevel - 3) * PER_LEVEL_ENERGY;
}

export function getStorageStructures(base: Base): StructureStorage[] {
  const structures = [];

  const room = getBasePrimaryRoom(base);
  if (!room) {
    return structures;
  }

  if (room.storage?.isActive()) {
    structures.push(room.storage);
  }

  if (room.terminal?.isActive()) {
    structures.push(room.terminal);
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
  let spawns: StructureSpawn[] = [];

  const primaryRoom = getBasePrimaryRoom(base);
  if (!primaryRoom) {
    return spawns;
  }

  spawns = primaryRoom.find(FIND_MY_STRUCTURES, {
    filter: (structure: AnyStructure) => {
      return structure.structureType === STRUCTURE_SPAWN;
    }
  });

  return spawns;
}

export function getBaseLevel(base: Base): number {
  let level = 0;

  const room = getBasePrimaryRoom(base);
  if (!room) {
    return level;
  }

  if (room.controller?.level) {
    level = room.controller.level;
  }

  return level;
}

export function getBaseLevelCompleted(base: Base) {
  const room = getBasePrimaryRoom(base);
  if (!room) {
    return 0;
  }

  if (!room.controller?.my) {
    return 0;
  }

  return room.controller.progress / room.controller.progressTotal;
}

export function getDamagedStructures(base: Base): Structure[] {
  return base.damagedStructures.map((structureId) => {
    return Game.getObjectById(structureId);
  });
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

export function getStoredEffects(base: Base): EffectSet {
  return base.storedEffects;
}

export function getLoadedEffects(base: Base): LabsByAction {
  return base.labsByAction;
}

// Base thread
export interface BaseTheadActionFunc {
  (trace: Tracer, kernel: Kernel, base: Base, ...args: any[]): void;
}

export interface BaseThreadFunc {
  (trace: Tracer, kernel: Kernel, base: Base, ...args: any[]): void;
  reset(): void;
}

export const threadBase = (name: string, ttl: number) => (action: BaseTheadActionFunc): BaseThreadFunc => {
  let lastCall = 0;

  const tick = function (trace: Tracer, kernel: Kernel, base: Base, ...args: any[]): void {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      const actionTrace = trace.begin(name);
      const result = action(actionTrace, kernel, base, ...args);
      actionTrace.end();

      return result;
    } else {
      trace.info(`thread ${name} sleeping for ${lastCall + ttl - Game.time}`);
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};

export function resetRemotes(base: Base, trace: Tracer): void {
  trace.notice(`resetting remotes ${base.id}`);
  base.rooms = [base.primary];
}

export function addRoom(base: Base, roomName: string, trace: Tracer): void {
  trace.notice('adding room', {baseId: base.id, roomName});

  if (base.rooms.indexOf(roomName) !== -1) {
    trace.error('room already exists', {roomName});
    return;
  }

  base.rooms.push(roomName);
}

export function removeRoom(base: Base, roomName: string, trace: Tracer): void {
  trace.notice('removing room', {roomName});

  if (roomName === base.primary) {
    trace.error("can't remove primary room", {roomName});
    return;
  }

  base.rooms = _.without(base.rooms, roomName);

  trace.info('room removed from colony', {colonyId: base.id, roomName});
}
