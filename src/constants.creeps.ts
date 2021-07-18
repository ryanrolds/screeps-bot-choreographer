export const WORKER_BUILDER = 'builder';
export const WORKER_HARVESTER = 'harvester';
export const WORKER_MINER = 'miner';
export const WORKER_UPGRADER = 'upgrader';
export const WORKER_DEFENDER = 'defender';
export const WORKER_DEFENDER_DRONE = 'defender_drone';
export const WORKER_ATTACKER = 'attacker';
export const WORKER_REPAIRER = 'repairer';
export const WORKER_DISTRIBUTOR = 'distributor';
export const WORKER_RESERVER = 'reserver';
export const WORKER_HAULER = 'hauler';
export const WORKER_EXPLORER = 'explorer';

// The 'base' should at most 300 energy as it will form the base of the creep
// The 'parts' are additional parts that will be used to fill up to the 'energyLimit'
export const DEFINITIONS = {
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
    // 1 tower
    energyMinimum: 6500,
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    // energyMinimum: 6000,
    // parts: [MOVE, TOUGH, MOVE, ATTACK, HEAL, HEAL],
    // base: [MOVE, TOUGH, MOVE, ATTACK],
    // energyMinimum: 8450,
    // parts: [MOVE, MOVE, TOUGH, ATTACK, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL],
    // base: [MOVE, MOVE, TOUGH, ATTACK, HEAL, HEAL, HEAL, HEAL, HEAL, HEAL],
    // boosts: ['heal', 'damage', 'attack'],
    processPriority: 2,
  },
  [WORKER_EXPLORER]: {
    energyLimit: 50,
    parts: [],
    base: [MOVE],
    processPriority: 5,
  },
};
