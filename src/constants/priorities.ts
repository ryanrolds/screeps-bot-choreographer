// Spawn requests
export const PRIORITY_DISTRIBUTOR = 19; // if zero distributes priority +10
export const PRIORITY_MINER_PRIMARY = 17; // primary room priority
export const PRIORITY_HAULER = 15;
export const PRIORITY_DEFENDER = 15; // hostile presence in base rooms
export const PRIORITY_BUFFER_PATROL = 15;
export const PRIORITY_UPGRADER = 14; // logic reduces priority: n * 2
export const PRIORITY_MINER_REMOTE = 13; // remote rooms should have lower priority then base ops
export const PRIORITY_RESERVER = 13; // many things request reservers/claimers
export const PRIORITY_REPAIRER_URGENT = 12;
export const PRIORITY_HARVESTER = 11;
export const PRIORITY_BUILDER = 11;
export const EXPLORER = 10;
export const DISTRIBUTOR_NO_RESERVE = 9; // no energy stored, don't use regular distributor
export const PRIORITY_ATTACKER = 8;
export const PRIORITY_HARASSER = 8;
export const PRIORITY_REPAIRER = 7;
export const PRIORITY_REMOTE_HARVESTER = 5;

// Prioritize setting up additional colonies
export const PRIORITY_BOOTSTRAP = 0;

// Terminal
export const TERMINAL_SELL = 1;
export const TERMINAL_BUY = 2;
export const TERMINAL_TRANSFER = 3;
export const TERMINAL_ENERGY_BALANCE = 4;

// Dropped/Source hauling
export const DUMP_NEXT_TO_STORAGE = -10;
export const HAUL_DROPPED = 5;
export const HAUL_CONTAINER = 0;
export const HAUL_BASE_ROOM = 5;
export const HAUL_REMOTE_ROOM = 0;
export const LOAD_FACTOR = 0.2;

// Core Hauling
export const UNLOAD_LINK = 2;
export const LOAD_LINK = 1.9;
export const UNLOAD_BOOST = 1.7;
export const HAUL_BOOST = 1.6;
export const HAUL_TOWER_HOSTILES = 1.5;
export const HAUL_TOWER = 1.5;
export const HAUL_EXTENSION = 1.4;
export const HAUL_TERMINAL = 1.1;
export const HAUL_REACTION = 1.0;

export const HAUL_CORE_DROPPED = 0.9;
export const HAUL_NUKER = 0.8;

// Reactions
export const REACTION_PRIORITIES = {
  G: 12,
  OH: 13,
  ZK: 9,
  UL: 9,
  LH: 1, // repair/build
  ZH: 6, // dismantle
  KH: 4, // carry
  UH: 6, // attack
  GH: 14, // upgrade controller
  LO: 9, // heal
  ZO: 1, // fatigue
  KO: 6, // ranged attack
  UO: 1, // harvest
  GO: 5, // damage
  LH2O: 1, // repair/build
  KH2O: 5, // carry
  ZH2O: 6, // dismantle
  UH2O: 7, // attack
  GH2O: 15, // upgrade controller
  LHO2: 10, // heal
  UHO2: 1, // harvest
  KHO2: 6, // ranged attack
  ZHO2: 1, // fatigue
  GHO2: 6, // damage
  XLH2O: 1, // repair/build
  XKH2O: 6, // carry
  XZH2O: 8, // dismantle
  XUH2O: 8, // attack
  XGH2O: 16, // upgrade controller
  XLHO2: 11, // heal
  XUHO2: 1, // harvest
  XKHO2: 7, // ranged attack
  XZHO2: 1, // fatigue
  XGHO2: 7, // damage
};
