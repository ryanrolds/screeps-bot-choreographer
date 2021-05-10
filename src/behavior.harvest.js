
const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');
const behaviorMovement = require('./behavior.movement');
const {MEMORY_HARVEST_ROOM, MEMORY_SOURCE} = require('./constants.memory');
const {numEnemeiesNearby, numOfSourceSpots} = require('./helpers.proximity');

module.exports.selectHarvestSource = behaviorTree.leafNode(
  'bt.harvest.selectHarvestSource',
  (creep, trace, kingdom) => {
    let sources = creep.room.find(FIND_SOURCES);
    sources = _.filter(sources, (source) => {
      // Do not send creeps to sources with hostiles near by
      return numEnemeiesNearby(source.pos, 5) < 1;
    });

    const room = kingdom.getCreepRoom(creep);
    if (!room) {
      return FAILURE;
    }

    sources = _.sortByAll(sources, (source) => {
      const numAssigned = _.filter(room.assignedCreeps, (creep) => {
        return creep.memory[MEMORY_SOURCE] === source.id;
      }).length;

      const numSpots = numOfSourceSpots(source);
      return Math.floor(numAssigned / numSpots);
    }, (source) => {
      const path = creep.pos.findPathTo(source);
      return path.length;
    });

    if (!sources || !sources.length) {
      return FAILURE;
    }

    const source = sources[0];

    behaviorMovement.setSource(creep, source.id);
    return SUCCESS;
  },
);

module.exports.moveToHarvestRoom = behaviorTree.repeatUntilSuccess(
  'bt.movement.room.harvest',
  behaviorTree.leafNode(
    'move_to_harvest_room',
    (creep) => {
      const room = creep.memory[MEMORY_HARVEST_ROOM];
      // If creep doesn't have a harvest room assigned, we are done
      if (!room) {
        return SUCCESS;
      }
      // If the creep reaches the room we are done
      if (creep.room.name === room) {
        return SUCCESS;
      }

      const result = creep.moveTo(new RoomPosition(25, 25, room), {
        reusePath: 50,
        maxOps: 1500,
      });
      if (result === ERR_NO_PATH) {
        return FAILURE;
      }
      if (result === ERR_INVALID_ARGS) {
        return FAILURE;
      }

      return RUNNING;
    },
  ),
);

module.exports.moveToHarvest = behaviorTree.leafNode(
  'move_to_source',
  (creep) => {
    return behaviorMovement.moveToSource(creep, 1, false, 50, 1500);
  },
);

module.exports.harvest = behaviorTree.leafNode(
  'fill_creep',
  (creep) => {
    const destination = Game.getObjectById(creep.memory.source);
    if (!destination) {
      return FAILURE;
    }

    const result = creep.harvest(destination);
    if (result === ERR_FULL) {
      return SUCCESS;
    }
    if (creep.store.getFreeCapacity() === 0) {
      return SUCCESS;
    }
    if (result === ERR_NOT_ENOUGH_RESOURCES) {
      return RUNNING;
    }
    if (result == OK) {
      return RUNNING;
    }

    return FAILURE;
  },
);
