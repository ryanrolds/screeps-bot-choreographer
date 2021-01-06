const WORKER_BUILDER = module.exports.WORKER_BUILDER = 'builder';
const WORKER_HARVESTER = module.exports.WORKER_HARVESTER = 'harvester';
const WORKER_REMOTE_HARVESTER = module.exports.WORKER_REMOTE_HARVESTER = 'remote_harvester';
const WORKER_REMOTE_MINER = module.exports.WORKER_REMOTE_MINER = 'remote_miner';
const WORKER_MINER = module.exports.WORKER_MINER = 'miner';
const WORKER_UPGRADER = module.exports.WORKER_UPGRADER = 'upgrader';
const WORKER_DEFENDER = module.exports.WORKER_DEFENDER = 'defender';
const WORKER_ATTACKER = module.exports.WORKER_ATTACKER = 'attacker';
const WORKER_REPAIRER = module.exports.WORKER_REPAIRER = 'repairer';
const WORKER_DISTRIBUTOR = module.exports.WORKER_DISTRIBUTOR = 'distributor';
const WORKER_CLAIMER = module.exports.WORKER_CLAIMER = 'claimer';
const WORKER_RESERVER = module.exports.WORKER_RESERVER = 'reserver';
const WORKER_HAULER = module.exports.WORKER_HAULER = 'hauler_v3';

// The 'base' should at most 300 energy as it will form the base of the creep
// The 'parts' are additional parts that will be used to fill up to the 'energyLimit'
const definitions = {
  [WORKER_HARVESTER]: {
    energyLimit: 600,
    parts: [CARRY, MOVE, WORK, MOVE],
    base: [CARRY, MOVE, MOVE, WORK],
  },
  [WORKER_REMOTE_HARVESTER]: {
    energyLimit: 1050,
    ignoreSpawnEnergyLimit: true,
    parts: [CARRY, MOVE, WORK, MOVE],
    base: [CARRY, MOVE, WORK, MOVE],
  },
  [WORKER_MINER]: {
    energyLimit: 900,
    ignoreSpawnEnergyLimit: true,
    parts: [WORK],
    base: [CARRY, MOVE, WORK, WORK],
  },
  [WORKER_REMOTE_MINER]: {
    energyLimit: 1300,
    ignoreSpawnEnergyLimit: true,
    parts: [WORK, MOVE],
    base: [CARRY, MOVE, WORK, MOVE],
  },
  [WORKER_HAULER]: {
    energyLimit: 1500,
    ignoreSpawnEnergyLimit: true,
    parts: [MOVE, CARRY, CARRY],
    base: [MOVE, CARRY, CARRY, MOVE, CARRY, CARRY],
  },
  [WORKER_BUILDER]: {
    energyLimit: 1500,
    parts: [CARRY, MOVE, WORK, MOVE],
    base: [CARRY, MOVE, WORK, MOVE],
  },
  [WORKER_REPAIRER]: {
    energyLimit: 900,
    parts: [MOVE, CARRY, WORK],
    base: [CARRY, MOVE, WORK],
  },
  [WORKER_UPGRADER]: {
    energyLimit: 2000,
    parts: [MOVE, CARRY, MOVE, WORK],
    base: [CARRY, MOVE, CARRY, MOVE, WORK],
  },
  [WORKER_DISTRIBUTOR]: {
    energyLimit: 1000,
    parts: [MOVE, CARRY, CARRY],
    base: [CARRY, MOVE, CARRY, CARRY, MOVE, CARRY],
  },
  [WORKER_CLAIMER]: {
    energyLimit: 1950,
    parts: [CLAIM, MOVE],
    base: [MOVE, CLAIM],
  },
  [WORKER_RESERVER]: {
    energyLimit: 1950,
    parts: [CLAIM, MOVE],
    base: [MOVE, CLAIM],
  },
  [WORKER_DEFENDER]: {
    energyLimit: null,
    parts: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    base: [MOVE, TOUGH, MOVE, TOUGH, MOVE, RANGED_ATTACK],
  },
  [WORKER_ATTACKER]: {
    energyLimit: null,
    energyMinimum: 2200,
    parts: [MOVE, TOUGH, ATTACK, HEAL],
    base: [MOVE, TOUGH, MOVE, ATTACK],
  },
};

module.exports = {
  WORKER_BUILDER,
  WORKER_HARVESTER,
  WORKER_REMOTE_HARVESTER,
  WORKER_MINER,
  WORKER_REMOTE_MINER,
  WORKER_UPGRADER,
  WORKER_DEFENDER,
  WORKER_ATTACKER,
  WORKER_REPAIRER,
  WORKER_DISTRIBUTOR,
  WORKER_CLAIMER,
  WORKER_RESERVER,
  WORKER_HAULER,
  // definitions
  definitions,
};
