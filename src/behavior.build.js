const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const {MEMORY_FLAG} = require('./constants.memory');
const {getPrioritizedSites} = require('./lib.construction');

const selectSite = behaviorTree.leafNode(
  'selectSite',
  (creep, trace, kingdom) => {
    const sites = getPrioritizedSites(creep.room);
    if (sites.length === 0) {
      return FAILURE;
    }

    const site = sites[0];
    behaviorMovement.setDestination(creep, site.id, site.room.id);
    return behaviorTree.SUCCESS;
  },
);

const selectSiteNearFlag = behaviorTree.leafNode(
  'selectSiteNearFlag',
  (creep) => {
    const flagID = creep.memory[MEMORY_FLAG];
    if (!flagID) {
      return FAILURE;
    }

    const flag = Game.flags[flagID];
    if (!flag) {
      return FAILURE;
    }

    if (!flag.room) {
      return FAILURE;
    }

    const target = flag.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
    if (!target) {
      return FAILURE;
    }

    behaviorMovement.setDestination(creep, target.id, target.room.id);
    return SUCCESS;
  },
);

const build = behaviorTree.leafNode(
  'build',
  (creep) => {
    const destination = Game.getObjectById(creep.memory.destination);
    if (!destination) {
      return FAILURE;
    }

    const result = creep.build(destination);
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return SUCCESS;
    }
    if (result === ERR_INVALID_TARGET) {
      return FAILURE;
    }
    if (result != OK) {
      return FAILURE;
    }
    if (creep.store.getUsedCapacity() === 0) {
      return SUCCESS;
    }

    return RUNNING;
  },
);

module.exports = {
  selectSite,
  build,
  selectSiteNearFlag,
};
