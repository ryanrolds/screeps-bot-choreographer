import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {running, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";

export default class ObserverRunnable {
  id: Id<StructureObserver>;
  observer: Observer;

  constructor(id: Id<StructureObserver>) {
    this.id = id;
  }


}

export class Observer implements Runnable {
  id: Id<StructureObserver>;
  inRangeRooms: Id<Room>[];
  justObserved: Id<Room>;

  constructor(id: Id<StructureObserver>) {
    this.id = id;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.as('observer_run');

    const observer = Game.getObjectById(this.id);
    if (!observer) {
      trace.error('missing structure', {id: this.id});
      trace.end();
      return terminate();
    }

    if (this.justObserved && Game.rooms[this.justObserved]) {
      kernel.getScribe().updateRoom(kernel, Game.rooms[this.justObserved], trace);
    }

    trace.log('in range rooms', {inRange: this.inRangeRooms});

    const getOldestRoomTrace = trace.begin('get_oldest_room');
    const nextRoom = kernel.getScribe().getOldestRoomInList(this.inRangeRooms);
    getOldestRoomTrace.end();

    trace.log('next room', {nextRoom});

    if (!nextRoom) {
      trace.end();
      return running();
    }

    const observeRoomTrace = trace.begin('observe_room');
    const result = observer.observeRoom(nextRoom);
    observeRoomTrace.end();

    if (result === OK) {
      this.justObserved = nextRoom as Id<Room>;
    } else {
      this.justObserved = null;
    }

    trace.end();
    return running();
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


