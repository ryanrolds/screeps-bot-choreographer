export enum AlertLevel {
  GREEN = "green",
  YELLOW = "yellow",
  RED = "red",
};

export interface BaseMap {
  [id: string]: BaseConfig;
}

export interface BaseConfig {
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
}

export function getBasePrimaryRoom(base: BaseConfig): Room {
  return Game.rooms[base.primary];
}

export interface ShardMap {
  [id: string]: ShardConfig;
}

export interface ShardConfig {
  buffer: number;
  friends: string[];
  neutral: string[];
  avoid: string[];
  kos: string[];
  authorizedSieges: string[];
  maxColonies: number;
  autoExpand: boolean;
  explorers: boolean;
  autoAttack: boolean;
}
