import {ENTIRE_ROOM_BOUNDS, getCutTiles, Graph, NORMAL, PROTECTED, RoomMatrix, testRoomMatrix, TO_EXIT, UNWALKABLE} from "./lib.min_cut";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";

export default class MinCutDebugger {
  id: string;
  graph: Graph;
  matrix: RoomMatrix;
  cut: RoomPosition[];

  constructor(id: string, kingdom: Kingdom) {
    this.id = id;
    this.graph = null;
    this.matrix = null;
    this.cut = null;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace.log("mincut debugger", {});

    if (this.graph && Game.time % 1 === 0) {

    }

    if (this.matrix && Game.time % 2 === 0) {
      let visual = new RoomVisual(this.matrix.roomName);

      // Visualize the room
      for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
          const vertex = this.matrix.get(x, y);
          if (vertex === UNWALKABLE) {
            visual.circle(x, y, {radius: 0.5, fill: '#111166', opacity: 0.3});
          } else if (vertex === NORMAL) {
            visual.circle(x, y, {radius: 0.5, fill: '#e8e863', opacity: 0.3});
          } else if (vertex === PROTECTED) {
            visual.circle(x, y, {radius: 0.5, fill: '#75e863', opacity: 0.3});
          } else if (vertex === TO_EXIT) {
            visual.circle(x, y, {radius: 0.5, fill: '#b063e8', opacity: 0.3});
          }
        }
      }

      // Visualize the top edge count
      /*
      for (let x = 0; x < 49; x++) {
        for (let y = 0; y < 49; y++) {
          let edges = this.graph.getTopEdges(x, y);
          visual.text(`T${edges.length.toString()}`, x, y, {align: 'left', font: 0.2});
          edges.forEach(edge => {
            const x2 = edge.x();
            const y2 = edge.y();
            visual.line(x, y, x2, edge.y, {color: '#ffffff', width: 0.1});
          });

          edges = this.graph.getBottomEdges(x, y);
          visual.text(`B${edges.length.toString()}`, x, y, {align: 'right', font: 0.2});
        }
      }
      */
    }

    if (this.cut) {
      const roomVisual = new RoomVisual(this.matrix.roomName);
      for (const pos of this.cut) {
        roomVisual.text('X', pos.x, pos.y);
      }
    }

    return running();
  }

  debug(kingdom: Kingdom, roomName: string) {
    const trace = new Tracer('mincut_deugger', {pid: 'mincut_debugger'}, 0);

    const baseConfig = kingdom.getPlanner().getBaseConfigById(roomName);
    trace.notice('baseConfig', {origin: baseConfig?.origin});

    const baseOrigin = baseConfig.origin;
    const baseBounds = {
      x1: baseOrigin.x - 10, y1: baseOrigin.y - 10,
      x2: baseOrigin.x + 10, y2: baseOrigin.y + 10,
    };

    let cpu = Game.cpu.getUsed();
    const [cut, matrix, graph] = getCutTiles(roomName, [baseBounds], ENTIRE_ROOM_BOUNDS)
    this.cut = cut;
    this.matrix = matrix;
    this.graph = graph;
    cpu = Game.cpu.getUsed() - cpu;

    trace.notice('path', {roomName, cpu, cut, matrix});
  }

  clear() {
    this.matrix = null;
    this.cut = null;
  }
}
