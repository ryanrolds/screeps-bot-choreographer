import {
  DismissedReasonAdjacentClaimed, DismissedReasonDifferentRoomStatus, DismissedReasonNoController, DismissedReasonNoRoomEntry,
  DismissedReasonOwned, ExpandResults, pickExpansion
} from "./lib.expand";
import {Tracer} from './lib.tracing';
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";


export default class PlannerDebugger {
  id: string;
  results: ExpandResults = null;
  display: boolean = false;
  kernel: Kernel;

  constructor(id: string, kernel: Kernel) {
    this.id = id;
    this.kingdom = kingdom;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace.log("expand debugger run", {results: this.results});

    if (this.display) {
      if (!this.results || Game.time % 50 === 0) {
        this.results = pickExpansion(this.kingdom, trace);
      }

      trace.notice("expand debugger", {results: this.results});

      const selected = this.results.selected;
      if (selected) {
        Game.map.visual.text('O', new RoomPosition(25, 25, selected), {color: '#00ff00', fontSize: 20});
        new RoomVisual(selected).text('x', this.results.origin, {color: '#00ff00'});
      }

      _.forEach(this.results.candidates, (selected, roomName) => {
        Game.map.visual.text('0', new RoomPosition(25, 25, roomName), {color: '#0000ff', fontSize: 20});
      });

      _.forEach(this.results.claimed, (selected, roomName) => {
        Game.map.visual.text('X', new RoomPosition(25, 25, roomName), {color: '#0000ff', fontSize: 20});
      });

      _.forEach(this.results.dismissed, (resaon, roomName) => {
        let text = 'X';
        switch (resaon) {
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
      });
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
