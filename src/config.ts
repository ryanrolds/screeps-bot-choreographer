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
