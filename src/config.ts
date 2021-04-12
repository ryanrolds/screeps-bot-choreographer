
export interface ShardConfig {
  [key: string]: ColonyConfig;
}

export interface ColonyConfig {
  id: string;
  primary: string;
  rooms: string[];
}

export interface KingdomConfig {
  [key: string]: ShardConfig;
}
