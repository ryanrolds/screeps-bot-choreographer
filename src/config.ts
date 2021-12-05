
export interface ShardConfig {
  [key: string]: ColonyConfig;
}

export interface ColonyConfig {
  id: NonNullable<string>;
  primary: NonNullable<string>;
  rooms: NonNullable<string[]>;
  origin: NonNullable<RoomPosition>;
  isPublic: boolean;
  automated: boolean;
}

export interface KingdomConfig {
  buffer: number;
  friends: string[];
  neutral: string[];
  avoid: string[];
  kos: string[];
  shards: Record<string, ShardConfig>;
}
