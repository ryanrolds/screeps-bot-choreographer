const behaviorTree = require('./lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('./lib.behaviortree');

const behaviorMovement = require('./behavior.movement');
const behaviorCommute = require('./behavior.commute');
const behaviorAssign = require('./behavior.assign');
const behaviorRoom = require('./behavior.room');
const behaviorNonCombatant = require('./behavior.noncombatant');
const behaviorBoosts = require('./behavior.boosts');

const {MEMORY_DESTINATION} = require('./constants.memory');

const selectStructureToRepair = behaviorTree.leafNode(
  'selectStructureToRepair',
  (creep, trace, kingdom) => {
    const room = kingdom.getCreepRoom(creep);
    if (!room) {
      return FAILURE;
    }

    const target = room.getNextDamagedStructure();
    if (!target) {
      return FAILURE;
    }

    behaviorMovement.setDestination(creep, target.id);

    return SUCCESS;
  },
);

const repair = behaviorTree.leafNode(
  'repair_structure',
  (creep) => {
    const destination = Game.getObjectById(creep.memory[MEMORY_DESTINATION]);
    if (!destination) {
      return FAILURE;
    }

    // TODO this should not be a failure, I need to makea RepeatCondition node
    if (destination.hits >= destination.hitsMax) {
      return SUCCESS;
    }

    const result = creep.repair(destination);
    if (result != OK) {
      return FAILURE;
    }

    return RUNNING;
  },
);

const behavior = behaviorTree.sequenceNode(
  'repair',
  [
    behaviorAssign.moveToRoom,
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.repeatUntilConditionMet(
      'repair_until_empty',
      (creep, trace, kingdom) => {
        if (creep.store.getUsedCapacity() === 0) {
          return true;
        }

        return false;
      },
      behaviorTree.sequenceNode(
        'select_and_repair',
        [
          selectStructureToRepair,
          behaviorMovement.moveToDestination(1),
          repair,
        ],
      ),
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('repairer', behaviorBoosts(behaviorNonCombatant(behavior))),
};
