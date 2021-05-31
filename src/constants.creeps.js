const WORKER_BUILDER = module.exports.WORKER_BUILDER = 'builder';
const WORKER_HARVESTER = module.exports.WORKER_HARVESTER = 'harvester';
const WORKER_MINER = module.exports.WORKER_MINER = 'miner';
const WORKER_UPGRADER = module.exports.WORKER_UPGRADER = 'upgrader';
const WORKER_DEFENDER = module.exports.WORKER_DEFENDER = 'defender';
const WORKER_DEFENDER_DRONE = module.exports.WORKER_DEFENDER_DRONE = 'defender_drone';
const WORKER_ATTACKER = module.exports.WORKER_ATTACKER = 'attacker';
const WORKER_REPAIRER = module.exports.WORKER_REPAIRER = 'repairer';
const WORKER_DISTRIBUTOR = module.exports.WORKER_DISTRIBUTOR = 'distributor';
const WORKER_RESERVER = module.exports.WORKER_RESERVER = 'reserver';
const WORKER_HAULER = module.exports.WORKER_HAULER = 'hauler';
const WORKER_EXPLORER = module.exports.WORKER_EXPLORER = 'explorer';

// The 'base' should at most 300 energy as it will form the base of the creep
// The 'parts' are additional parts that will be used to fill up to the 'energyLimit'
const definitions = {
  [WORKER_HARVESTER]: {
    energyLimit: 3200,
    parts: [MOVE, CARRY, WORK],
    base: [CARRY, WORK, MOVE],
    // boosts: ['harvest'],
    processPriority: 2,
  },
  [WORKER_MINER]: {
    energyLimit: 1750,
    ignoreSpawnEnergyLimit: true,
    parts: [MOVE, CARRY, WORK, WORK],
    base: [MOVE, CARRY, WORK, WORK],
    // boosts: ['harvest'],
    processPriority: 2,
  },
  [WORKER_HAULER]: {
    ignoreSpawnEnergyLimit: true,
    parts: [MOVE, CARRY, CARRY],
    base: [MOVE, CARRY, CARRY, MOVE, CARRY, CARRY],
    // boosts: ['capacity'],
    processPriority: 3,
  },
  [WORKER_BUILDER]: {
    energyLimit: 1500,
    parts: [MOVE, CARRY, WORK],
    base: [MOVE, CARRY, WORK],
    // boosts: ['build'],
    processPriority: 4,
  },
  [WORKER_REPAIRER]: {
    energyLimit: 900,
    parts: [CARRY, MOVE, WORK, MOVE],
    base: [CARRY, MOVE, WORK, MOVE],
    // boosts: ['repair'],
    processPriority: 4,
  },
  [WORKER_UPGRADER]: {
    parts: [MOVE, CARRY, WORK],
    base: [CARRY, MOVE, CARRY, MOVE, WORK],
    boosts: ['upgradeController'],
    processPriority: 3,
  },
  [WORKER_DISTRIBUTOR]: {
    energyLimit: 2000,
    parts: [MOVE, CARRY, CARRY],
    base: [MOVE, CARRY, CARRY, MOVE, CARRY, CARRY],
    // boosts: ['capacity'],
    processPriority: 2,
  },
  [WORKER_RESERVER]: {
    energyLimit: 2600,
    parts: [CLAIM, MOVE],
    base: [MOVE, CLAIM],
    // boosts: ['upgradeController'],
    processPriority: 4,
  },
  [WORKER_DEFENDER]: {
    energyLimit: null,
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    base: [MOVE, RANGED_ATTACK],
    boosts: ['heal', 'damage', 'rangedAttack'],
    processPriority: 1,
  },
  [WORKER_DEFENDER_DRONE]: {
    energyLimit: null,
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    base: [MOVE, RANGED_ATTACK],
    boosts: ['heal', 'damage', 'rangedAttack'],
    processPriority: 1,
  },
  [WORKER_ATTACKER]: {
    energyLimit: null,
    energyMinimum: 4000,
    parts: [MOVE, TOUGH, MOVE, ATTACK, MOVE, HEAL],
    base: [MOVE, TOUGH, MOVE, ATTACK],
    boosts: ['heal', 'damage', 'attack'],
    processPriority: 2,
  },
  [WORKER_EXPLORER]: {
    energyLimit: 50,
    parts: [],
    base: [MOVE],
    processPriority: 5,
  },
};

module.exports = {
  WORKER_BUILDER,
  WORKER_HARVESTER,
  WORKER_MINER,
  WORKER_UPGRADER,
  WORKER_DEFENDER,
  WORKER_DEFENDER_DRONE,
  WORKER_ATTACKER,
  WORKER_REPAIRER,
  WORKER_DISTRIBUTOR,
  WORKER_RESERVER,
  WORKER_HAULER,
  WORKER_EXPLORER,
  // definitions
  definitions,
};
