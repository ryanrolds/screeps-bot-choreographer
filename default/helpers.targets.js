const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;

module.exports.getEnergyContainerTargets = (creep) => {
  let targets = creep.room.find(FIND_STRUCTURES, {
    filter: (structure) => {
      return structure.structureType == STRUCTURE_CONTAINER && structure.store.getUsedCapacity() >= 50;
    },
  });

  if (!targets || !targets.length) {
    return null;
  }

  targets = _.sortBy(targets, (target) => {
    return target.store.getFreeCapacity();
  });

  return getClosestTarget(creep, targets);
};

module.exports.getDamagedStructure = (creep) => {
  let targets = creep.room.find(FIND_STRUCTURES, {
    filter: (structure) => {
      return (
        (structure.hits < structure.hitsMax &&
          (
            structure.structureType != STRUCTURE_WALL &&
            structure.structureType != STRUCTURE_RAMPART
          )
        ) ||
        (structure.hits < WALL_LEVEL && structure.structureType === STRUCTURE_WALL) ||
        (structure.hits < RAMPART_LEVEL && structure.structureType === STRUCTURE_RAMPART)
      );
    },
  });

  if (!targets.length) {
    return null;
  }

  targets = _.sortBy(targets, (structure) => {
    return structure.hits / structure.hitsMax;
  });

  return targets[0];
};

const getClosestTarget = module.exports.getClosestTarget = (creep, targets) => {
  targets = _.sortBy(targets, (target) => {
    const result = PathFinder.search(creep.pos, {pos: target.pos});
    if (result.incomplete) {
      return 99999;
    }

    return result.cost;
  });

  if (!targets || !targets.length) {
    return null;
  }

  return targets.shift();
};
