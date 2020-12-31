const behaviorTree = require('lib.behaviortree');
const {FAILURE, SUCCESS, RUNNING} = require('lib.behaviortree');
const {MEMORY_FLAG} = require('constants.memory');

module.exports.moveToFlag = behaviorTree.sequenceNode(
  'move_to_flag',
  [
    behaviorTree.leafNode(
      'move_to_flag_leaf',
      (creep) => {
        const flagID = creep.memory[MEMORY_FLAG];
        if (!flagID) {
          return FAILURE;
        }

        const flag = Game.flags[flagID];
        if (!flag) {
          return FAILURE;
        }

        if (creep.pos.inRangeTo(flag, 3)) {
          return SUCCESS;
        }

        const result = creep.moveTo(flag);
        if (result === ERR_NO_PATH) {
          return FAILURE;
        }

        if (result !== OK && result !== ERR_TIRED) {
          return FAILURE;
        }

        return RUNNING;
      },
    ),
  ],
);
