export interface BaseMap {
  [id: string]: BaseConfig;
}

export type BaseConfig = {
  id: NonNullable<string>;
  primary: NonNullable<string>;
  rooms: NonNullable<string[]>;
  origin: NonNullable<RoomPosition>;
  parking: RoomPosition;
  isPublic: NonNullable<boolean>;
  automated: NonNullable<boolean>;
  walls: NonNullable<{x: number, y: number}[]>;
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
  maxColonies: number;
  autoExpand: boolean;
  bases: BaseMap;
}
