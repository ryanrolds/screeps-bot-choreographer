import {Kernel} from './kernel';
import {Metrics} from './lib.metrics';
import {ENTIRE_ROOM_BOUNDS, getCutTiles, Graph, NORMAL, NO_BUILD, PROTECTED, RoomMatrix, TO_EXIT, UNWALKABLE} from './lib.min_cut';
import {Tracer} from './lib.tracing';
import {running} from './os.process';
import {RunnableResult} from './os.runnable';

export default class MinCutDebugger {
  id: string;
  graph: Graph;
  matrix: RoomMatrix;
  cut: RoomPosition[];

  constructor(id: string) {
    this.id = id;
    this.graph = null;
    this.matrix = null;
    this.cut = null;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace.info('mincut debugger', {});

    if (this.matrix && Game.time % 2 === 0) {
      const visual = new RoomVisual(this.matrix.roomName);

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
          } else if (vertex === NO_BUILD) {
            visual.circle(x, y, {radius: 0.5, fill: '#7878eb', opacity: 0.3});
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

  debug(kernel: Kernel, roomName: string) {
    const trace = new Tracer('mincut_deugger', new Map([['pid', 'mincut_debugger']]), new Metrics());

    const base = kernel.getPlanner().getBaseById(roomName);
    trace.notice('base', {origin: base?.origin});

    const baseOrigin = base.origin;
    const baseBounds = {
      x1: baseOrigin.x - 9, y1: baseOrigin.y - 9,
      x2: baseOrigin.x + 9, y2: baseOrigin.y + 9,
    };

    const protect = [baseBounds];

    /* In the future we will build walls around key assets
    Game.rooms[roomName].find(FIND_SOURCES).forEach(source => {
      protect.push({
        x1: source.pos.x - 2, y1: source.pos.y - 2,
        x2: source.pos.x + 2, y2: source.pos.y + 2,
      });
    });

    Game.rooms[roomName].find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_EXTRACTOR ||
          structure.structureType === STRUCTURE_LINK ||
          structure.structureType === STRUCTURE_CONTAINER;
      }
    }).forEach(structure => {
      protect.push({
        x1: structure.pos.x - 2, y1: structure.pos.y - 2,
        x2: structure.pos.x + 2, y2: structure.pos.y + 2,
      });
    })


    Game.rooms[roomName].find(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_CONTROLLER;
      }
    }).forEach(structure => {
      protect.push({
        x1: structure.pos.x - 1, y1: structure.pos.y - 1,
        x2: structure.pos.x + 1, y2: structure.pos.y + 1,
      });
    });
    */

    let cpu = Game.cpu.getUsed();
    const [cut, matrix, graph] = getCutTiles(roomName, protect, ENTIRE_ROOM_BOUNDS);
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
