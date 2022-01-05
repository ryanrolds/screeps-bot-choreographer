import {RoomMatrix, testRoomMatrix} from "./lib.min_cut";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";

export default class MinCutDebugger {
  id: string;
  results: RoomMatrix;

  constructor(id: string, kingdom: Kingdom) {
    this.id = id;
    this.results = null;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace.log("path debugger", {path: this.results})

    if (this.results) {
      const roomVisual = new RoomVisual(this.results.roomName);
      for (let i = 0; i <= 49; i++) {
        for (let j = 0; j <= 49; j++) {
          roomVisual.text(this.results.get(i, j).toString(), i, j);
        }
      }
    }

    return running();
  }

  debug(roomName: string) {
    const trace = new Tracer('mincut_deugger', {pid: 'mincut_debugger'}, 0);

    const matrix = testRoomMatrix(roomName);

    trace.notice('path', {roomName, matrix});
    this.results = matrix;
  }

  clear() {
    this.results = null;
  }
}
