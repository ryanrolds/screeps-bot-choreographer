import {getMusterVector, Vector} from '../lib/muster';
import {DIRECTION_OFFSET} from '../lib/position';
import {Tracer} from '../lib/tracing';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, running} from '../os/process';

export default class MusterDebugger {
  id: string;
  vector: Vector;

  constructor(id: string) {
    this.id = id;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace.info('muster debugger', {});

    if (this.vector) {
      visualizeVector(this.vector, trace);
    }

    return running();
  }

  debug(roomName: string) {
    const kernel = global.AI;
    const base = kernel.getPlanner().getBaseByRoom(roomName);
    this.vector = getMusterVector(base);
  }

  clear() {
    this.vector = null;
  }
}

function visualizeVector(vector: Vector, trace: Tracer) {
  const roomVisual = Game.rooms[vector.pos.roomName].visual;
  if (!roomVisual) {
    trace.warn('no room visual', {room: vector.pos.roomName});
    return;
  }

  for (let i = 0; i < vector.magnitude; i++) {
    let char = '0'
    if (i === 0) {
      char = 'X';
    }

    const x = vector.pos.x + i * DIRECTION_OFFSET[vector.direction].x;
    const y = vector.pos.y + i * DIRECTION_OFFSET[vector.direction].y;
    const pos = new RoomPosition(x, y, vector.pos.roomName);
    roomVisual.text(char, pos);
  }
}
