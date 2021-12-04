// Spawn requests
export const PRIORITY_MINER = 18;
export const PRIORITY_HARVESTER = 17;
export const PRIORITY_DISTRIBUTOR = 16;
export const PRIORITY_HAULER = 15;
export const PRIORITY_DEFENDER = 14;
export const PRIORITY_UPGRADER = 13;
export const PRIORITY_REMOTE_MINER = 12;
export const PRIORITY_REPAIRER_URGENT = 11.5;
export const PRIORITY_RESERVER = 11;
export const PRIORITY_CLAIMER = 11;
export const DISTRIBUTOR_NO_RESERVE = 10;
export const PRIORITY_ATTACKER = 10;
export const PRIORITY_REPAIRER = 8;
export const PRIORITY_BUFFER_PATROL = 7;
export const PRIORITY_REMOTE_HARVESTER = 7;
export const PRIORITY_BUILDER = 5;
export const EXPLORER = 2;

// Prioritize setting up additional colonies
export const PRIORITY_BOOTSTRAP = 0;

// Terminal
export const TERMINAL_SELL = 1;
export const TERMINAL_BUY = 2;
export const TERMINAL_TRANSFER = 3;
export const TERMINAL_ENERGY_BALANCE = 4;

// Long hauling
export const HAUL_DROPPED = 10.0;
export const HAUL_CONTAINER = 1.0;

// Core Hauling
export const UNLOAD_LINK = 2;
export const HAUL_TOWER_HOSTILES = 1.6;
export const HAUL_BOOST = 1.5;
export const UNLOAD_BOOST = 1.5;
export const HAUL_TOWER = 1.5;
export const LOAD_LINK = 1.4;
export const HAUL_TERMINAL = 1.3;
export const HAUL_REACTION = 1.2;
export const HAUL_EXTENSION = 1.0;

export const HAUL_CORE_DROPPED = 0.9;
export const HAUL_NUKER = 0.8;

// Reactions
export const REACTION_PRIORITIES = {
  G: 11,
  OH: 12,
  ZK: 9,
  UL: 9,
  LH: 1, // repair/build
  ZH: 6, // dismantle
  KH: 4, // carry
  UH: 6, // attack
  GH: 13, // upgrade controller
  LO: 11, // heal
  ZO: 1, // fatigue
  KO: 6, // ranged attack
  UO: 1, // harvest
  GO: 5, // damage
  LH2O: 1, // repair/build
  KH2O: 5, // carry
  ZH2O: 6, // dismantle
  UH2O: 7, // attack
  GH2O: 14, // upgrade controller
  LHO2: 12, // heal
  UHO2: 1, // harvest
  KHO2: 6, // ranged attack
  ZHO2: 1, // fatigue
  GHO2: 6, // damage
  XLH2O: 1, // repair/build
  XKH2O: 6, // carry
  XZH2O: 8, // dismantle
  XUH2O: 8, // attack
  XGH2O: 15, // upgrade controller
  XLHO2: 13, // heal
  XUHO2: 1, // harvest
  XKHO2: 7, // ranged attack
  XZHO2: 1, // fatigue
  XGHO2: 7, // damage
};
