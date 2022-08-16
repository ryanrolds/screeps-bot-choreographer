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


const friends = [];
const neutral = [];
const avoid = [];
const kos = [];

export const shards: ShardMap = {
  'default': {
    buffer: 3,
    friends: friends,
    neutral: neutral,
    avoid: avoid,
    kos: kos,
    authorizedSieges: [],
    maxColonies: 10,
    autoExpand: true,
    autoAttack: true,
    explorers: true,
  },
  'shard2': {
    buffer: 3,
    friends: friends,
    neutral: neutral,
    avoid: avoid,
    kos: kos,
    authorizedSieges: [],
    maxColonies: 11,
    autoExpand: true,
    autoAttack: true,
    explorers: true,
  },
  'shard3': {
    buffer: 3,
    friends: friends,
    neutral: neutral,
    avoid: avoid,
    kos: kos,
    authorizedSieges: [],
    maxColonies: 7,
    autoExpand: false,
    autoAttack: true,
    explorers: false,
  },
};
