import roleExplorer from "./role.explorer";

import {roleHarvester} from "./role.harvester";
import {roleUpgrader} from "./role.upgrader";
import {roleBuilder} from "./role.builder";
import {roleRepairer} from "./role.repairer";
import {roleHauler} from "./role.hauler";
import {roleMiner} from "./role.miner";
import {roleDistributor} from "./role.distributor";
import {roleDefender} from "./role.defender";
import roleDefenderDrone from "./role.defender_drone";
import roleAttacker from "./role.attacker";
import {roleReserver} from "./role.reserver";
import {roleWorker} from "./role.worker";

import * as CREEPS from "./constants.creeps";
import * as MEMORY from "./constants.memory";

import {DEFINITIONS} from "./constants.creeps";
import {MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_ORIGIN_SHARD} from './constants.memory';

const MIN_BUCKET_THROTTLE = 1000;

export const tick = (kingdom, trace) => {
  // Take modulus of tick to give us an offset so that we don't always skip
  // the same 20%
  let skipCount = Game.time % 5;

  _.each(Game.creeps, (creep) => {
    if (creep.spawning) {
      return;
    }

    skipCount++;

    // On first tick, set the start tick
    const startTick = creep.memory[MEMORY.MEMORY_START_TICK];
    if (!startTick) {
      creep.memory[MEMORY.MEMORY_START_TICK] = Game.time;
    }

    // TODO move the below to a map and/or lookup function

    const role = creep.memory[MEMORY_ROLE];

    if (role == CREEPS.WORKER_ATTACKER) {
      roleAttacker.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_DEFENDER) {
      roleDefender.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_DEFENDER_DRONE) {
      roleDefenderDrone.run(creep, trace, kingdom);
      return;
    }

    // If we are running low on CPU start skipping 20% of non-essential creeps
    if (Game.cpu.bucket < MIN_BUCKET_THROTTLE) {
      if (skipCount % 5 === 0) {
        return;
      }
    }

    if (role == CREEPS.WORKER_DISTRIBUTOR) {
      roleDistributor.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_MINER) {
      roleMiner.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.ROLE_WORKER) {
      roleWorker.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_HARVESTER) {
      roleHarvester.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_UPGRADER) {
      roleUpgrader.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_BUILDER) {
      roleBuilder.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_REPAIRER) {
      roleRepairer.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_HAULER) {
      roleHauler.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_RESERVER) {
      roleReserver.run(creep, trace, kingdom);
      return;
    }

    if (role == CREEPS.WORKER_EXPLORER) {
      roleExplorer.run(creep, trace, kingdom);
      return;
    }
  });

  if (Game.time % 100 === 0) {
    // Cleanup old creep memory
    for (const i in Memory.creeps) {
      if (!Game.creeps[i]) {
        delete Memory.creeps[i];
      }
    }
  }
};


export const createCreep = (colony, room, spawn, role, memory, energy, energyLimit) => {
  const definition = DEFINITIONS[role];

  const ignoreSpawnEnergyLimit = definition.ignoreSpawnEnergyLimit || false;
  if (energy > energyLimit && !ignoreSpawnEnergyLimit) {
    energy = energyLimit;
  }

  const roleEnergyLimit = definition.energyLimit;
  if (roleEnergyLimit && energy > roleEnergyLimit) {
    energy = roleEnergyLimit;
  }

  const parts = getBodyParts(definition, energy);

  const name = [role, Game.shard.name, Game.time].join('_');

  // Requests to the kingdom should include the destination colony, don't overwrite it
  if (!memory[MEMORY.MEMORY_BASE]) {
    memory[MEMORY.MEMORY_BASE] = colony;
  }

  // Used for debugging, don't use for decision making, use MEMORY_BASE instead
  memory[MEMORY_ORIGIN_SHARD] = Game.shard.name;
  memory[MEMORY_ORIGIN] = room;

  memory[MEMORY_ROLE] = role;
  memory[MEMORY.DESIRED_BOOSTS] = definition.boosts;

  //   `${parts}, ${JSON.stringify(memory)}`);

  const result = spawn.spawnCreep(parts, name, {memory});
  return result;
};

function getBodyParts(definition, maxEnergy) {
  let base = definition.base.slice(0);
  let i = 0;

  while (true) {
    const nextPart = definition.parts[i % definition.parts.length];
    const estimate = base.concat([nextPart]).reduce((acc, part) => {
      return acc + BODYPART_COST[part];
    }, 0);

    if (estimate <= maxEnergy && base.length < 50) {
      base.push(nextPart);
    } else {
      break;
    }

    i++;
  }

  base = _.sortBy(base, (part) => {
    switch (part) {
      case TOUGH:
        return 0;
      case WORK:
      case CARRY:
        return 1;
      case MOVE:
        return 2;
      case ATTACK:
        return 8;
      case RANGED_ATTACK:
        return 9;
      case HEAL:
        return 10;
      default:
        return 1;
    }
  });

  return base;
}

export function scoreCreep(creep: Creep): number {
  return 0;
}
