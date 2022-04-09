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
  automated: NonNullable<boolean>;
  walls: NonNullable<{x: number, y: number}[]>;
  neighbors: NonNullable<string[]>;
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
}
