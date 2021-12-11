
export interface ShardConfig {
  [key: string]: ColonyConfig;
}

export interface ColonyConfig {
  id: NonNullable<string>;
  primary: NonNullable<string>;
  rooms: NonNullable<string[]>;
  origin: NonNullable<RoomPosition>;
  parking: RoomPosition;
  isPublic: NonNullable<boolean>;
  automated: NonNullable<boolean>;
}

export interface KingdomConfig {
  buffer: number;
  friends: string[];
  neutral: string[];
  avoid: string[];
  kos: string[];
  maxColonies: number;
  shards: Record<string, ShardConfig>;
}
