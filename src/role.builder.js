const behaviorTree = require('./lib.behaviortree');
const behaviorCommute = require('./behavior.commute');
const behaviorMovement = require('./behavior.movement');
const behaviorBuild = require('./behavior.build');
const behaviorRoom = require('./behavior.room');
const {behaviorBoosts} = require('./behavior.boosts');

const MEMORY = require('./constants.memory');
const {common} = require('./lib.pathing_policies');

const behavior = behaviorTree.sequenceNode(
  'builder_root',
  [
    behaviorMovement.moveToShard(MEMORY.MEMORY_ASSIGN_SHARD),
    behaviorTree.leafNode('set_controller_location', (creep, trace, kingdom) => {
      const assignedRoom = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];

      let posStr = [25, 25, assignedRoom].join(',');

      const roomEntry = kingdom.getScribe().getRoomById(assignedRoom);
      if (roomEntry?.controller?.pos) {
        const pos = roomEntry.controller?.pos;
        posStr = [pos.x, pos.y, pos.roomName].join(',');
      }

      creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = posStr;

      return behaviorTree.SUCCESS;
    }),
    behaviorMovement.cachedMoveToMemoryPos(MEMORY.MEMORY_ASSIGN_ROOM_POS, 3, common),
    behaviorCommute.setCommuteDuration,
    behaviorRoom.getEnergy,
    behaviorTree.sequenceNode(
      'build_construction_site',
      [
        behaviorTree.selectorNode(
          'pick_something',
          [
            behaviorBuild.selectSite,
            behaviorRoom.parkingLot,
          ],
        ),
        behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_DESTINATION, 1, common),
        behaviorBuild.build,
      ],
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('builder', behaviorBoosts(behavior)),
};
