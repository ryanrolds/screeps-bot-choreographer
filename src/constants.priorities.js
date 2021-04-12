// Spawn requests
const PRIORITY_MINER = 16;
const PRIORITY_DISTRIBUTOR = 15;
const PRIORITY_HAULER = 14;
const PRIORITY_DEFENDER = 13;
const PRIORITY_REMOTE_MINER = 12;
const PRIORITY_REMOTE_HAULER = 11;
const DISTRIBUTOR_NO_RESERVE = 10;
const PRIORITY_ATTACKER = 10;
const PRIORITY_HARVESTER = 9;
const PRIORITY_REPAIRER_URGENT = 8.5;
const PRIORITY_UPGRADER = 8;
const PRIORITY_REMOTE_HARVESTER = 7;
const PRIORITY_REPAIRER = 6;
const PRIORITY_BUILDER = 5;
const PRIORITY_CLAIMER = 4;
const PRIORITY_RESERVER = 3;
const EXPLORER = 2;

// Prioritize setting up additional colonies
const PRIORITY_BOOTSTRAP = 0;

// Terminal
const TERMINAL_SELL = 1;
const TERMINAL_BUY = 2;
const TERMINAL_TRANSFER = 3;

// Hauling
const HAUL_REACTION = 0.9;
const HAUL_BOOST = 1;

// Reactions
REACTION_PRIORITIES = {
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

module.exports = {
  PRIORITY_DISTRIBUTOR,
  DISTRIBUTOR_NO_RESERVE,
  PRIORITY_DEFENDER,
  PRIORITY_HARVESTER,
  PRIORITY_REMOTE_HARVESTER,
  PRIORITY_MINER,
  PRIORITY_REMOTE_MINER,
  PRIORITY_HAULER,
  PRIORITY_REMOTE_HAULER,
  PRIORITY_UPGRADER,
  PRIORITY_BUILDER,
  PRIORITY_REPAIRER,
  PRIORITY_REPAIRER_URGENT,
  PRIORITY_CLAIMER,
  PRIORITY_RESERVER,
  EXPLORER,
  PRIORITY_ATTACKER,
  PRIORITY_BOOTSTRAP,
  TERMINAL_SELL,
  TERMINAL_BUY,
  TERMINAL_TRANSFER,
  HAUL_REACTION,
  HAUL_BOOST,
  REACTION_PRIORITIES,
};
