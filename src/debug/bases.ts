import {
  DismissedReasonAdjacentClaimed, DismissedReasonDifferentRoomStatus, DismissedReasonNoController, DismissedReasonNoRoomEntry,
  DismissedReasonOwned, ExpandResults, pickExpansion
} from '../lib/expand';
import {Tracer} from '../lib/tracing';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, running} from '../os/process';


export default class BasesDebugger {
  id: string;
  results: ExpandResults = null;
  display = false;
  kernel: Kernel;

  constructor(id: string, kernel: Kernel) {
    this.id = id;
    this.kernel = kernel;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace.info('expand debugger run', {results: this.results});

    if (this.display) {
      if (!this.results || Game.time % 10 === 0) {
        this.results = pickExpansion(this.kernel, trace);
      }

      trace.info('expand debugger', {results: this.results});

      const selected = this.results.selected;
      if (selected) {
        Game.map.visual.text('O', new RoomPosition(25, 25, selected), {color: '#00ff00', fontSize: 20});
        new RoomVisual(selected).text('x', this.results.origin, {color: '#00ff00'});
      }

      for (const roomName of this.results.candidates.keys()) {
        Game.map.visual.text('0', new RoomPosition(25, 25, roomName), {color: '#0000ff', fontSize: 20});
      }

      for (const roomName of this.results.claimed.keys()) {
        Game.map.visual.text('X', new RoomPosition(25, 25, roomName), {color: '#0000ff', fontSize: 20});
      }

      for (const [roomName, reason] of this.results.dismissed) {
        let text = 'X';
        switch (reason) {
          case DismissedReasonNoController:
            text = 'NC';
            break;
          case DismissedReasonNoRoomEntry:
            text = 'NE';
            break;
          case DismissedReasonAdjacentClaimed:
            text = 'AC';
            break;
          case DismissedReasonOwned:
            text = 'OW';
            break;
          case DismissedReasonDifferentRoomStatus:
            text = 'RS';
            break;
          default:
            text = '?';
        }

        Game.map.visual.text(text, new RoomPosition(25, 25, roomName), {color: '#ff0000', fontSize: 20});
      }
    }

    return running();
  }

  debug() {
    this.display = true;
  }

  clear() {
    this.display = false;
  }
}
