const roleHarvester = require('./role.harvester');
const roleUpgrader = require('./role.upgrader');
const roleBuilder = require('./role.builder');
const roleRepairer = require('./role.repairer');
const roleHauler = require('./role.hauler');
const roleMiner = require('./role.miner');
const roleDistributor = require('./role.distributor');
const roleDefender = require('./role.defender');
const roleDefenderDrone = require('./role.defender_drone');
const roleAttacker = require('./role.attacker');
const roleReserver = require('./role.reserver');

const CREEPS = require('./constants.creeps');
const MEMORY = require('./constants.memory');

const {definitions} = require('./constants.creeps');
const {MEMORY_ROLE, MEMORY_ORIGIN, MEMORY_COLONY, MEMORY_ORIGIN_SHARD} = require('./constants.memory');

const MIN_BUCKET_THROTTLE = 1000;

module.exports.tick = (kingdom, trace) => {
  // Take modulus of tick to give us an offset so that we don't always skip
  // the same 20%
  let skipCount = Game.time % 5;

  _.each(Game.creeps, (creep) => {
    if (creep.spawning) {
      return;
    }

    skipCount++;

    // TODO move the below to a map and/or lookup function

    if (creep.memory.role == CREEPS.WORKER_ATTACKER) {
      roleAttacker.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_DEFENDER) {
      roleDefender.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_DEFENDER_DRONE) {
      roleDefenderDrone.run(creep, trace, kingdom);
      return;
    }

    // If we are running low on CPU start skipping 20% of non-essential creeps
    if (Game.cpu.bucket < MIN_BUCKET_THROTTLE) {
      if (skipCount % 5 === 0) {
        return;
      }
    }

    if (creep.memory.role == CREEPS.WORKER_DISTRIBUTOR) {
      roleDistributor.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_MINER) {
      roleMiner.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_HARVESTER) {
      roleHarvester.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_UPGRADER) {
      roleUpgrader.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_BUILDER) {
      roleBuilder.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_REPAIRER) {
      roleRepairer.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_HAULER) {
      roleHauler.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_RESERVER) {
      roleReserver.run(creep, trace, kingdom);
      return;
    }

    if (creep.memory.role == CREEPS.WORKER_EXPLORER) {
      creep.suicide();
      // roleExplorer.run(creep, trace, kingdom);
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

module.exports.createCreep = (colony, room, spawn, role, memory, energy, energyLimit) => {
  const definition = definitions[role];

  const ignoreSpawnEnergyLimit = definition.ignoreSpawnEnergyLimit || false;
  const roleEnergyLimit = definition.energyLimit;
  if (roleEnergyLimit && energy > roleEnergyLimit) {
    energy = roleEnergyLimit;
  }

  if (energy > energyLimit && !ignoreSpawnEnergyLimit) {
    energy = energyLimit;
  }

  const parts = getBodyParts(definition, energy);

  const name = [role, Game.shard.name, Game.time].join('_');

  // Requests to the kingdom should include the destination colony, don't overwrite it
  if (!memory[MEMORY_COLONY]) {
    memory[MEMORY_COLONY] = colony;
  }

  memory[MEMORY_ORIGIN_SHARD] = Game.shard.name;
  memory[MEMORY_ORIGIN] = room;
  memory[MEMORY_ROLE] = role;
  memory[MEMORY.MEMORY_START_TICK] = Game.time;
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
