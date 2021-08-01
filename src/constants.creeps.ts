import {Priorities} from './os.scheduler';

export const WORKER_BUILDER = 'builder';
export const WORKER_HARVESTER = 'harvester';
export const WORKER_MINER = 'miner';
export const WORKER_UPGRADER = 'upgrader';
export const WORKER_DEFENDER = 'defender';
export const WORKER_DEFENDER_BOOSTED = 'defender_boosted';
export const WORKER_DEFENDER_DRONE = 'defender_drone';
export const WORKER_ATTACKER = 'attacker';
export const WORKER_ATTACKER_1TOWER = 'attacker_1t';
export const WORKER_ATTACKER_2TOWER = 'attacker_2t';
export const WORKER_ATTACKER_3TOWER = 'attacker_3t';
export const WORKER_ATTACKER_6TOWER = 'attacker_6t';
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
    processPriority: Priorities.RESOURCES,
    skippable: true,
  },
  [WORKER_MINER]: {
    energyLimit: 1750,
    ignoreSpawnEnergyLimit: true,
    parts: [MOVE, CARRY, WORK, WORK],
    base: [MOVE, CARRY, WORK, WORK],
    // boosts: ['harvest'],
    processPriority: Priorities.RESOURCES,
    skippable: true,
  },
  [WORKER_HAULER]: {
    ignoreSpawnEnergyLimit: true,
    parts: [MOVE, CARRY, CARRY],
    base: [MOVE, CARRY, CARRY, MOVE, CARRY, CARRY],
    // boosts: ['capacity'],
    processPriority: Priorities.LOGISTICS,
    skippable: true,
  },
  [WORKER_BUILDER]: {
    energyLimit: 1500,
    parts: [MOVE, CARRY, WORK],
    base: [MOVE, CARRY, WORK],
    // boosts: ['build'],
    processPriority: Priorities.MAINTENANCE,
    skippable: true,
  },
  [WORKER_REPAIRER]: {
    energyLimit: 900,
    parts: [CARRY, MOVE, WORK, MOVE],
    base: [CARRY, MOVE, WORK, MOVE],
    // boosts: ['repair'],
    processPriority: Priorities.MAINTENANCE,
    skippable: true,
  },
  [WORKER_UPGRADER]: {
    parts: [MOVE, CARRY, WORK],
    base: [CARRY, MOVE, CARRY, MOVE, WORK],
    boosts: ['upgradeController'],
    processPriority: 3,
    skippable: true,
  },
  [WORKER_DISTRIBUTOR]: {
    energyLimit: 2000,
    parts: [MOVE, CARRY, CARRY],
    base: [MOVE, CARRY, CARRY, MOVE, CARRY, CARRY],
    // boosts: ['capacity'],
    processPriority: Priorities.LOGISTICS,
    skippable: true,
  },
  [WORKER_RESERVER]: {
    energyLimit: 2600,
    parts: [CLAIM, MOVE],
    base: [MOVE, CLAIM],
    // boosts: ['upgradeController'],
    processPriority: Priorities.EXPLORATION,
    skippable: true,
  },
  [WORKER_DEFENDER]: {
    energyLimit: null,
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    base: [MOVE, RANGED_ATTACK],
    //boosts: ['heal', 'damage', 'rangedAttack'],
    processPriority: Priorities.DEFENCE,
    skippable: false,
  },
  [WORKER_DEFENDER_BOOSTED]: {
    energyLimit: null,
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    base: [MOVE, RANGED_ATTACK],
    boosts: ['heal', 'damage', 'rangedAttack'],
    processPriority: Priorities.DEFENCE,
    skippable: false,
  },
  [WORKER_DEFENDER_DRONE]: {
    energyLimit: null,
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    base: [MOVE, RANGED_ATTACK],
    boosts: ['heal', 'damage', 'rangedAttack'],
    processPriority: Priorities.DEFENCE,
    skippable: true,
  },
  [WORKER_ATTACKER]: {
    energyLimit: null,
    energyMinimum: 6000,
    parts: [WORK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, RANGED_ATTACK, WORK],
    base: [TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE, HEAL, HEAL, HEAL, HEAL, HEAL, RANGED_ATTACK, WORK, WORK],
    boosts: ['dismantle'],
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_1TOWER]: {
    energyLimit: null,
    energyMinimum: 6500,
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, ATTACK, MOVE],
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    boosts: ['attack'],
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_2TOWER]: {
    energyLimit: null,
    energyMinimum: 6500,
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    boosts: ['attack'],
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_3TOWER]: {
    energyLimit: null,
    energyMinimum: 6500,
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    boosts: ['heal', 'damage', 'attack'],
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_6TOWER]: {
    energyLimit: null,
    energyMinimum: 6500,
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    boosts: ['heal', 'damage', 'attack'],
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_EXPLORER]: {
    energyLimit: 50,
    parts: [],
    base: [MOVE],
    processPriority: Priorities.EXPLORATION,
    skippable: true,
  },
};
