import {Tracer} from './lib.tracing';
import {OrgBase} from './org.base';
import {Kingdom} from './org.kingdom';
import {Scribe} from './runnable.scribe';

export class Observer extends OrgBase {
  observer: StructureObserver;
  inRangeRooms: Id<Room>[];
  justObserved: Id<Room>;

  scribe: Scribe;

  constructor(parent: Kingdom, observer: StructureObserver, trace: Tracer) {
    super(parent, observer.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.observer = observer;
    this.inRangeRooms = inRangeRoomNames(observer.room.name);
    this.scribe = this.getKingdom().getScribe();

    setupTrace.end();
  }

  update(trace: Tracer) {
    const updateTrace = trace.begin('observer_update');

    this.observer = Game.getObjectById(this.id as Id<StructureObserver>);
    if (!this.observer) {
      updateTrace.error('missing observer', {id: this.id});
      updateTrace.end();
      return;
    }

    if (this.justObserved && Game.rooms[this.justObserved]) {
      const kingdom = this.getKingdom();
      kingdom.getScribe().updateRoom(kingdom, Game.rooms[this.justObserved], trace);
    }

    updateTrace.log('in range rooms', {inRange: this.inRangeRooms});

    const getOldestRoomTrace = updateTrace.begin('get_oldest_room');
    const nextRoom = this.scribe.getOldestRoomInList(this.inRangeRooms);
    getOldestRoomTrace.end();

    updateTrace.log('next room', {nextRoom});

    if (!nextRoom) {
      updateTrace.end();
      return;
    }

    const observeRoomTrace = updateTrace.begin('observe_room');
    const result = this.observer.observeRoom(nextRoom);
    observeRoomTrace.end();

    if (result === OK) {
      this.justObserved = nextRoom as Id<Room>;
    } else {
      this.justObserved = null;
    }

    updateTrace.end();
  }

  process(trace: Tracer) {
    const processTrace = trace.begin('process');

    processTrace.end();
  }

  toString() {
    return `** Observer - Id: ${this.id}, Room: ${this.observer.room.name}, ` +
      `LastScanned: ${this.justObserved}, #InRange: ${this.inRangeRooms.length}`;
  }
}

const inRangeRoomNames = (centerRoomName: string): Id<Room>[] => {
  const roomsInRange = [];
  const centerRoomXY = roomNameToXY(centerRoomName);
  const topLeft = [centerRoomXY[0] - 10, centerRoomXY[1] - 10];

  for (let i = 0; i < 21; i++) {
    for (let j = 0; j < 21; j++) {
      const roomName = roomNameFromXY(topLeft[0] + i, topLeft[1] + j);
      if (Game.map.getRoomStatus(roomName).status !== 'closed') {
        roomsInRange.push(roomName);
      }
    }
  }

  return roomsInRange;
};

// https://github.com/screeps/engine/blob/master/src/utils.js
const roomNameFromXY = (x, y): Id<Room> => {
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
  return ('' + x + y) as Id<Room>;
};

// https://github.com/screeps/engine/blob/master/src/utils.js
const roomNameToXY = (name: string): [number, number] => {
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

