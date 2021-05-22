
const behaviorTree = require('./lib.behaviortree');
const {SUCCESS} = require('./lib.behaviortree');
const behaviorAssign = require('./behavior.assign');
const {MEMORY_ASSIGN_ROOM} = require('./constants.memory');

const behavior = behaviorTree.sequenceNode(
  'explorer_root',
  [
    behaviorTree.leafNode(
      'update_room_with_scribe',
      (creep, trace, kingdom) => {
        kingdom.getScribe().updateRoom(creep.room);

        return SUCCESS;
      },
    ),
    behaviorTree.leafNode(
      'select_next_room',
      (creep, trace, kingdom) => {
        // Don't notify me when creep wonders into hostile room
        creep.notifyWhenAttacked(false);

        const currentRoomStatus = Game.map.getRoomStatus(creep.room.name);
        let exits = Object.values(Game.map.describeExits(creep.room.name));
        exits = exits.filter((exit) => {
          const exitStatus = Game.map.getRoomStatus(exit);
          return currentRoomStatus.status === exitStatus.status;
        });

        let entries = exits.map((roomId) => {
          const entry = kingdom.getScribe().getRoomById(roomId);

          return {
            id: roomId,
            lastUpdated: (entry) ? entry.lastUpdated : 0,
          };
        });

        entries = _.sortBy(entries, 'lastUpdated');

        creep.memory[MEMORY_ASSIGN_ROOM] = entries[0].id;

        trace.log('next room', {next: entries[0].id});

        return SUCCESS;
      },
    ),
    behaviorAssign.moveToRoom,
    behaviorTree.leafNode(
      'move_into_room',
      (creep, trace, kingdom) => {
        creep.moveTo(new RoomPosition(25, 25, creep.room.name), {maxOps: 100});

        return SUCCESS;
      },
    ),
  ],
);

module.exports = {
  run: behaviorTree.rootNode('explorer', behavior),
};
