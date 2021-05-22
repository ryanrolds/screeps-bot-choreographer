const {OrgBase} = require('./org.base');

class Observer extends OrgBase {
  constructor(parent, observer, trace) {
    super(parent, observer.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.observer = observer;
    this.inRangeRooms = inRangeRoomNames(observer.room.name);
    this.justObserved = null;
    this.scribe = this.getKingdom().getScribe();

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.observer = Game.getObjectById(this.id);

    if (this.justObserved && Game.rooms[this.justObserved]) {
      const updateRoomTrace = updateTrace.begin('update_room');
      this.scribe.updateRoom(Game.rooms[this.justObserved]);
      updateRoomTrace.end();
    }

    trace.log('in range rooms', {inRange: this.inRangeRooms});

    const getOldestRoomTrace = updateTrace.begin('get_oldest_room');
    const nextRoom = this.scribe.getOldestRoomInList(this.inRangeRooms);
    getOldestRoomTrace.end();

    trace.log('next room', {nextRoom});

    if (nextRoom) {
      const observeRoomTrace = updateTrace.begin('observe_room');
      const result = this.observer.observeRoom(nextRoom);
      observeRoomTrace.end();

      trace.log('observe room result', {nextRoom, result});

      if (result === OK) {
        this.justObserved = nextRoom;
      } else {
        this.justObserved = false;
      }
    }

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    processTrace.end();
  }
  toString() {
    return `** Observer - Id: ${this.id}, Room: ${this.observer.room.name}, ` +
      `LastScanned: ${this.justObserved}, #InRange: ${this.inRangeRooms.length}`;
  }
}

const inRangeRoomNames = (centerRoomName) => {
  const roomsInRange = [];
  const centerRoomXY = roomNameToXY(centerRoomName);
  const topLeft = [centerRoomXY[0] - 10, centerRoomXY[1] - 10];

  for (let i = 0; i < 21; i++) {
    for (let j = 0; j < 21; j++) {
      const roomName = roomNameFromXY(topLeft[0] + i, topLeft[1] + j);
      if (Game.map.getRoomStatus(roomName) !== 'closed') {
        roomsInRange.push(roomName);
      }
    }
  }

  return roomsInRange;
};

// https://github.com/screeps/engine/blob/master/src/utils.js
const roomNameFromXY = (x, y) => {
  if (x < 0) {
    x = 'W' + (-x - 1);
  } else {
    x = 'E' + (x);
  }
  if (y < 0) {
    y = 'N' + (-y - 1);
  } else {
    y = 'S' + (y);
  }
  return '' + x + y;
};

// https://github.com/screeps/engine/blob/master/src/utils.js
const roomNameToXY = (name) => {
  let xx = parseInt(name.substr(1), 10);
  let verticalPos = 2;
  if (xx >= 100) {
    verticalPos = 4;
  } else if (xx >= 10) {
    verticalPos = 3;
  }
  let yy = parseInt(name.substr(verticalPos + 1), 10);
  const horizontalDir = name.charAt(0);
  const verticalDir = name.charAt(verticalPos);
  if (horizontalDir === 'W' || horizontalDir === 'w') {
    xx = -xx - 1;
  }
  if (verticalDir === 'N' || verticalDir === 'n') {
    yy = -yy - 1;
  }
  return [xx, yy];
};

module.exports = Observer;
