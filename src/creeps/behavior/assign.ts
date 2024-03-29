import * as MEMORY from '../../constants/memory';

//const MEMORY_PREV_ROOM = 'previous_room';

export const clearRoom = (creep: Creep) => {
  delete creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
  delete creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
};

/*
export const moveToRoom = behaviorTree.repeatUntilSuccess(
  'moveToAssignedRoom',
  behaviorTree.leafNode(
    'move_to_exit',
    (creep: Creep, trace: Tracer, _kernel: Kernel) => {
      const roomID = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      if (!roomID) {
        return SUCCESS;
      }

      const previousRoom = creep.memory[MEMORY_PREV_ROOM] || 'unknown';
      const currentRoom = creep.room.name;
      const changedRooms = currentRoom !== previousRoom;
      creep.memory[MEMORY_PREV_ROOM] = currentRoom;

      if (currentRoom === roomID && changedRooms) {
        const result = creep.moveTo(new RoomPosition(25, 25, creep.room.name), {maxOps: 100, range: 22});
        trace.info('moving to center', {result});
        return SUCCESS;
      } else if (currentRoom === roomID) {
        trace.info('in room', {room: currentRoom});
        return SUCCESS;
      }

      let position = null;

      const positionString = creep.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
      if (positionString) {
        const posArray = positionString.split(',');
        if (posArray && posArray.length === 3) {
          position = new RoomPosition(posArray[0], posArray[1], posArray[2]);
        }
      }

      if (!position) {
        position = new RoomPosition(25, 25, roomID);
      }

      const result = creep.moveTo(position, {
        reusePath: 50,
        maxOps: 10000,
      });

      trace.info('move to exit result', {
        result,
      });

      if (result === ERR_NO_PATH) {
        return RUNNING;
      }

      return RUNNING;
    },
  ),
);
*/
