/**
 * Creep definitions
 *
 * TODO move to role files
 */
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
export const ROLE_WORKER = 'worker';

type CreepRoleDefinition = {
  base: BodyPartConstant[],
  parts: BodyPartConstant[],
  boosts: string[],
  energyLimit: number,
  energyMinimum: number,
  ignoreSpawnEnergyLimit: boolean,
  processPriority: number,
  skippable: boolean,
}

// The 'base' should at most 300 energy as it will form the base of the creep
// The 'parts' are additional parts that will be used to fill up to the 'energyLimit'
export const DEFINITIONS: Record<string, CreepRoleDefinition> = {
  [WORKER_UPGRADER]: {
    base: [CARRY, WORK, MOVE],
    parts: [MOVE, WORK, WORK, MOVE, WORK, CARRY],
    boosts: ['upgradeController'],
    energyLimit: 0,
    energyMinimum: 200,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.CORE_LOGISTICS,
    skippable: true,
  },
  [WORKER_DISTRIBUTOR]: {
    base: [MOVE, WORK, CARRY],
    parts: [MOVE, CARRY, CARRY],
    boosts: [], // ['capacity']
    energyLimit: 0,
    energyMinimum: 200,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.CORE_LOGISTICS,
    skippable: true,
  },
  [WORKER_DEFENDER]: {
    base: [MOVE, RANGED_ATTACK],
    parts: [MOVE, HEAL, MOVE, RANGED_ATTACK, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    boosts: ['rangedAttack'],
    energyLimit: 0,
    energyMinimum: 1000,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.DEFENCE,
    skippable: false,
  },
  [WORKER_DEFENDER_BOOSTED]: {
    base: [MOVE, RANGED_ATTACK],
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    boosts: ['heal', 'damage', 'rangedAttack'],
    energyLimit: 0,
    energyMinimum: 1000,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.DEFENCE,
    skippable: false,
  },
  [WORKER_DEFENDER_DRONE]: {
    base: [MOVE, RANGED_ATTACK],
    parts: [MOVE, HEAL, MOVE, TOUGH, MOVE, RANGED_ATTACK, MOVE, TOUGH, MOVE, RANGED_ATTACK],
    boosts: [], // ['heal', 'damage', 'rangedAttack']
    energyLimit: 0,
    energyMinimum: 300,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.DEFENCE,
    skippable: true,
  },
  [WORKER_HARVESTER]: {
    base: [MOVE, CARRY, WORK],
    parts: [MOVE, WORK, WORK, MOVE, WORK, CARRY],
    boosts: [], // ['harvest']
    energyLimit: 3200,
    energyMinimum: 200,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.RESOURCES,
    skippable: true,
  },
  [ROLE_WORKER]: {
    base: [MOVE, WORK, CARRY],
    parts: [MOVE, CARRY, CARRY, MOVE, CARRY, WORK],
    boosts: [], // ['harvest']
    energyLimit: 0,
    energyMinimum: 300,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.RESOURCES,
    skippable: true,
  },
  [WORKER_MINER]: {
    base: [MOVE, CARRY, WORK, WORK],
    parts: [MOVE, WORK, WORK, WORK],
    boosts: [], // ['harvest']
    energyLimit: 1750,
    energyMinimum: 300,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.RESOURCES,
    skippable: true,
  },
  [WORKER_HAULER]: {
    base: [MOVE, WORK, CARRY],
    parts: [MOVE, CARRY, CARRY],
    boosts: [], // ['capacity']
    energyLimit: 0,
    energyMinimum: 200,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.LOGISTICS,
    skippable: true,
  },
  [WORKER_ATTACKER]: {
    base: [TOUGH, MOVE, MOVE, MOVE, MOVE, MOVE, HEAL, HEAL, HEAL, HEAL, HEAL, RANGED_ATTACK, WORK, WORK],
    parts: [WORK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, RANGED_ATTACK, WORK],
    boosts: [], // ['dismantle', 'heal', 'damage']
    energyLimit: 0,
    energyMinimum: 3000,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_1TOWER]: {
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, ATTACK, HEAL],
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    boosts: ['heal'],
    energyLimit: 0,
    energyMinimum: 2000,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_2TOWER]: {
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    boosts: ['heal', 'attack'],
    energyLimit: 0,
    energyMinimum: 6500,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_3TOWER]: {
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    boosts: ['heal', 'damage', 'attack'],
    energyLimit: 0,
    energyMinimum: 6500,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_ATTACKER_6TOWER]: {
    base: [TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, ATTACK, MOVE, HEAL, HEAL],
    parts: [ATTACK, TOUGH, MOVE, HEAL, MOVE, HEAL, MOVE, HEAL, HEAL, MOVE],
    boosts: ['heal', 'damage', 'attack'],
    energyLimit: 0,
    energyMinimum: 6500,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.ATTACK,
    skippable: false,
  },
  [WORKER_BUILDER]: {
    base: [MOVE, CARRY, WORK],
    parts: [MOVE, WORK, WORK, MOVE, WORK, CARRY],
    boosts: [], // ['build']
    energyLimit: 1500,
    energyMinimum: 200,
    ignoreSpawnEnergyLimit: true,
    processPriority: Priorities.MAINTENANCE,
    skippable: true,
  },
  [WORKER_REPAIRER]: {
    base: [CARRY, MOVE, WORK, MOVE],
    parts: [CARRY, MOVE, WORK, MOVE],
    boosts: [], // ['repair']
    energyLimit: 900,
    energyMinimum: 250,
    ignoreSpawnEnergyLimit: false,

    processPriority: Priorities.MAINTENANCE,
    skippable: true,
  },
  [WORKER_RESERVER]: {
    base: [MOVE, CLAIM],
    parts: [CLAIM, MOVE],
    boosts: [], // ['upgradeController']
    energyLimit: 2600,
    energyMinimum: 650,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.RESOURCES,
    skippable: true,
  },
  [WORKER_EXPLORER]: {
    base: [MOVE],
    parts: [],
    boosts: [],
    energyLimit: 50,
    energyMinimum: 50,
    ignoreSpawnEnergyLimit: false,
    processPriority: Priorities.EXPLORATION,
    skippable: true,
  },
};
