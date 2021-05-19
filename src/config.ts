
export interface ShardConfig {
  [key: string]: ColonyConfig;
}

export interface ColonyConfig {
  id: string;
  isPublic: boolean;
  primary: string;
  rooms: string[];
}

export interface KingdomConfig {
  friends: string[];
  avoid: string[];
  kos: string[];
  shards: Record<string, ShardConfig>;
}
