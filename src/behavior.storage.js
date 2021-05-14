
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const MEMORY = require('./constants.memory');

const {MEMORY_ROLE, MEMORY_DESTINATION, MEMORY_ORIGIN} = require('./constants.memory');
const {WORKER_DISTRIBUTOR, WORKER_HAULER} = require('./constants.creeps');

const spawnContainerCache = {};

const selectEnergyForWithdraw = module.exports.selectEnergyForWithdraw = behaviorTree.leafNode(
  'selectEnergyForWithdraw',
  (creep, trace, kingdom) => {
    const spawnContainers = spawnContainerCache[creep.room.name];
    if (!spawnContainers || !spawnContainers.length || Game.tick % 20 === 0) {
      const spawns = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_SPAWN;
        },
      });

      const spawnContainers = _.reduce(spawns, (acc, spawn) => {
        const containers = spawn.pos.findInRange(FIND_STRUCTURES, 8, {
          filter: (structure) => {
            return (structure.structureType == STRUCTURE_CONTAINER ||
              structure.structureType == STRUCTURE_STORAGE) &&
              structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        return acc.concat(containers);
      }, []);

      spawnContainerCache[creep.room.name] = spawnContainers;
    }

    const target = creep.pos.findClosestByRange(spawnContainers);
    if (!target) {
      return FAILURE;
    }

    behaviorMovement.setDestination(creep, target.id, Game.tick % 100);
    return SUCCESS;
  },
);

const selectRoomDropoff = module.exports.selectRoomDropoff = behaviorTree.selectorNode(
  'selectRoomDropoff',
  [
    behaviorTree.leafNode(
      'use_memory_dropoff',
      (creep) => {
        const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        if (dropoff) {
          behaviorMovement.setDestination(creep, dropoff);
          return SUCCESS;
        }


        return FAILURE;
      },
    ),
    behaviorTree.leafNode(
      'pick_adjacent_container',
      (creep) => {
        const role = creep.memory[MEMORY_ROLE];
        // haulers should pick containers near the spawner
        // TODO this is hacky and feels bad
        if (role && (role === WORKER_DISTRIBUTOR || role === WORKER_HAULER)) {
          return FAILURE;
        }

        const targets = creep.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: (structure) => {
            return structure.structureType == STRUCTURE_CONTAINER &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        if (!targets || !targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_adjacent_link',
      (creep) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const targets = creep.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: (structure) => {
            // TODO things seeking to gain energy should use another function
            return structure.structureType == STRUCTURE_LINK &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        if (!targets || !targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_storage',
      (creep, trace, kingdom) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const colony = kingdom.getCreepColony(creep);
        if (!colony) {
          return FAILURE;
        }

        const room = colony.getPrimaryRoom();
        if (!room) {
          return FAILURE;
        }

        if (!room.hasStorage) {
          return FAILURE;
        }

        if (!room.room.storage) {
          return FAILURE;
        }

        const distributors = _.filter(room.getCreeps(), (creep) => {
          return creep.memory[MEMORY.MEMORY_ROLE] === WORKER_DISTRIBUTOR;
        });

        if (!distributors.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, room.room.storage.id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_container',
      (creep, trace, kingdom) => {
        const role = creep.memory[MEMORY_ROLE];
        if (role && role === WORKER_DISTRIBUTOR) {
          return FAILURE;
        }

        const originID = creep.memory[MEMORY_ORIGIN];
        if (!originID) {
          return FAILURE;
        }

        const room = Game.rooms[originID];
        if (!room) {
          return FAILURE;
        }

        const distributors = room.find(FIND_MY_CREEPS, {
          filter: (creep) => {
            return creep.memory[MEMORY_ROLE] === WORKER_DISTRIBUTOR;
          },
        });

        if (!distributors.length) {
          return FAILURE;
        }

        const colony = kingdom.getCreepColony(creep);
        if (!colony) {
          return FAILURE;
        }

        const target = colony.getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
        if (!target) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, target.id);
        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'pick_spawner_extension',
      (creep) => {
        const originID = creep.memory[MEMORY_ORIGIN];
        if (!originID) {
          return FAILURE;
        }

        const room = Game.rooms[originID];
        if (!room) {
          return FAILURE;
        }

        const targets = room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return (structure.structureType == STRUCTURE_EXTENSION ||
              structure.structureType == STRUCTURE_SPAWN) &&
              structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
          },
        });

        if (!targets.length) {
          return FAILURE;
        }

        behaviorMovement.setDestination(creep, targets[0].id);
        return SUCCESS;
      },
    ),
  ],
);

module.exports.fillCreep = behaviorTree.sequenceNode(
  'energy_supply',
  [
    selectEnergyForWithdraw,
    behaviorMovement.moveToDestination(1, false),
    behaviorTree.leafNode(
      'fill_creep',
      (creep) => {
        return behaviorMovement.fillCreepFromDestination(creep);
      },
    ),
  ],
);

module.exports.fillCreepFrom = (from) => {
  return behaviorTree.sequenceNode(
    `fill_creep_from_${from}`,
    [
      from,
      behaviorMovement.moveToDestination(1),
      behaviorTree.leafNode(
        'fill_creep_from_destination',
        (creep) => {
          return behaviorMovement.fillCreepFromDestination(creep);
        },
      ),
    ],
  );
};

module.exports.emptyCreep = behaviorTree.repeatUntilConditionMet(
  'transfer_until_empty',
  (creep, trace, kingdom) => {
    if (creep.store.getUsedCapacity() === 0) {
      return true;
    }

    return false;
  },
  behaviorTree.sequenceNode(
    'dump_energy',
    [
      selectRoomDropoff,
      behaviorMovement.moveToDestinationRoom,
      behaviorMovement.moveToDestination(1, false),
      behaviorTree.leafNode(
        'empty_creep',
        (creep, trace, kingdom) => {
          if (creep.store.getUsedCapacity() === 0) {
            return SUCCESS;
          }

          const destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION]);
          if (!destination) {
            trace.log('no dump destination', {});
            return FAILURE;
          }

          const resource = Object.keys(creep.store).pop();

          const result = creep.transfer(destination, resource);
          trace.log('transfer result', {
            result,
          });

          if (result === ERR_FULL) {
            return SUCCESS;
          }

          if (result === ERR_NOT_ENOUGH_RESOURCES) {
            return SUCCESS;
          }

          if (result === ERR_INVALID_TARGET) {
            return SUCCESS;
          }

          if (result != OK) {
            return FAILURE;
          }

          return RUNNING;
        },
      ),
    ],
  ),
);

