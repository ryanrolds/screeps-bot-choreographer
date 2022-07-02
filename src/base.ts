import {Kernel} from "./ai.kernel";

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

  const base = kernel.getPlanning().getBaseById(baseId);
  if (!base) {
    return null;
  }

  return base;
}

export function getBoostPosition(base: Base): RoomPosition {
  return base.boostPosition;
}

export function getLabsForAction(base: Base, action: string): StructureLab[] {
  if (!base.boosts[action]) {
    return [];
  }

  return base.boosts[action];
}

export function setActionLabs(base: Base, action: string, labs: StructureLab[]): void {
  base.boosts[action] = labs;
}
