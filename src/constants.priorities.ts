// Spawn requests
export const PRIORITY_MINER = 16;
export const PRIORITY_DISTRIBUTOR = 15;
export const PRIORITY_HAULER = 14;
export const PRIORITY_DEFENDER = 13;
export const PRIORITY_REMOTE_MINER = 12;
export const PRIORITY_REMOTE_HAULER = 11;
export const PRIORITY_RESERVER = 11;
export const PRIORITY_CLAIMER = 11;
export const DISTRIBUTOR_NO_RESERVE = 10;
export const PRIORITY_ATTACKER = 10;
export const PRIORITY_HARVESTER = 9;
export const PRIORITY_REPAIRER_URGENT = 8.5;
export const PRIORITY_UPGRADER = 8;
export const PRIORITY_REMOTE_HARVESTER = 7;
export const PRIORITY_REPAIRER = 6;
export const PRIORITY_BUILDER = 5;

export const EXPLORER = 2;

// Prioritize setting up additional colonies
export const PRIORITY_BOOTSTRAP = 0;

// Terminal
export const TERMINAL_SELL = 1;
export const TERMINAL_BUY = 2;
export const TERMINAL_TRANSFER = 3;

// Long hauling
export const HAUL_DROPPED = 10.0;
export const HAUL_CONTAINER = 1.0;

// Core Hauling
export const HAUL_TOWER_HOSTILES = 1.6;
export const HAUL_BOOST = 1.5;
export const UNLOAD_BOOST = 1.5;
export const HAUL_TERMINAL = 1.3;
export const HAUL_REACTION = 1.2;
export const HAUL_EXTENSION = 1.0;
export const HAUL_TOWER = 1.0;
export const HAUL_NUKER = 0.8;

// Reactions
export const REACTION_PRIORITIES = {
  G: 10,
  OH: 11,
  ZK: 10,
  UL: 10,
  LH: 1, // repair/build
  ZH: 1, // dismantle
  GH: 10, // upgrade controller
  KH: 8, // carry
  UH: 8, // attack
  LO: 9, // heal
  ZO: 1, // fatigue
  KO: 9, // ranged attack
  UO: 1, // harvest
  GO: 9, // damage
  LH2O: 1, // repair/build
  KH2O: 8, // carry
  ZH2O: 1, // fatigue
  UH2O: 8, // attack
  GH2O: 10, // upgrade controller
  LHO2: 9, // heal
  UHO2: 1, // harvest
  KHO2: 9, // ranged attack
  ZHO2: 1, // fatigue
  GHO2: 9, // damage
  XLH2O: 1, // repair/build
  XKH2O: 8, // carry
  XZH2O: 1, // dismantle
  XUH2O: 8, // attack
  XGH2O: 10, // upgrade controller
  XLHO2: 9, // heal
  XUHO2: 1, // harvest
  XKHO2: 9, // ranged attack
  XZHO2: 1, // fatigue
  XGHO2: 9, // damage
};
