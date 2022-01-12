// require('util.min_cut').test('W5N9');

import {getNearbyPositions} from "./lib.position";
import BaseConstructionRunnable from "./runnable.base_construction";

/**
 * Posted 10 may 2018 by @saruss
 *
 * Code for calculating the minCut in a room, written by Saruss
 * adapted (for Typescript by Chobobobo , is it somewhere?)
 * some readability added by Chobobobo @typescript was included here
 * (15Aug2019) Updated Game.map.getTerrainAt to Game.map.getRoomTerrain method -Shibdib
 * (2022-01-03) Moved to TS by ENETDOWN
 */

class Rectangle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const ENTIRE_ROOM_BOUNDS: Rectangle = {x1: 0, y1: 0, x2: 49, y2: 49};

export const UNWALKABLE = -1;
export const NORMAL = 0;
export const PROTECTED = 1;
export const NO_BUILD = 2
export const TO_EXIT = 3;
export const EXIT = 4;

export class RoomMatrix {
  roomName: string;
  bounds: Rectangle;
  matrix: number[][];

  constructor(roomName: string, protect: Rectangle[], bounds: Rectangle) {
    this.roomName = roomName;
    this.bounds = bounds;
    this.matrix = this.createRoomMatrix(roomName, protect, bounds);
  }

  get(x: number, y: number): number {
    return this.matrix[x][y];
  }

  set(x: number, y: number, value: number): void {
    this.matrix[x][y] = value;
  }

  // create a 50x50 matrix, fill with unwalkable, set as normal if not at edge of room or walls
  private createRoomMatrix(roomName: string, protect: Rectangle[], bounds: Rectangle): number[][] {
    const matrix = Array(50).fill(0).map(x => Array(50).fill(UNWALKABLE));
    const terrain = Game.map.getRoomTerrain(roomName);

    for (let i = bounds.x1; i <= bounds.x2; i++) {
      for (let j = bounds.y1; j <= bounds.y2; j++) {
        // If wall, mark unwalkable
        if (terrain.get(i, j) === TERRAIN_MASK_WALL) {
          matrix[i][j] = UNWALKABLE;
          continue;
        }

        // If edge of boundary, mark as to exit
        if (i <= bounds.x1 || j <= bounds.y1 || i >= bounds.x2 || j >= bounds.y2) {
          matrix[i][j] = EXIT; // Sink Tiles mark from given bounds
          continue;
        }

        matrix[i][j] = NORMAL; // mark normal
      }
    }

    // Set tiles in matrix to PROTECTED if they are in the given rects
    const jmax = protect.length;
    for (let j = 0; j < jmax; j++) {
      let r = protect[j];
      for (let x = r.x1; x <= r.x2; x++) {
        for (let y = r.y1; y <= r.y2; y++) {
          if (x <= 2 || x >= 48 || y <= 2 || y >= 48) {
            continue;
          }

          if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
            matrix[x][y] = PROTECTED;
          }
        }
      }
    }

    // Marks tiles Near Exits for sink- where you cannot build wall/rampart
    const max = 49;
    for (let y = 1; y < 49; y++) {
      if (matrix[0][y - 1] === EXIT) matrix[1][y] = TO_EXIT;
      if (matrix[0][y] === EXIT) matrix[1][y] = TO_EXIT;
      if (matrix[0][y + 1] === EXIT) matrix[1][y] = TO_EXIT;
      if (matrix[49][y - 1] === EXIT) matrix[48][y] = TO_EXIT;
      if (matrix[49][y] === EXIT) matrix[48][y] = TO_EXIT;
      if (matrix[49][y + 1] === EXIT) matrix[48][y] = TO_EXIT;
    }

    for (let x = 1; x < 49; x++) {
      if (matrix[x - 1][0] === EXIT) matrix[x][1] = TO_EXIT;
      if (matrix[x][0] === EXIT) matrix[x][1] = TO_EXIT;
      if (matrix[x + 1][0] === EXIT) matrix[x][1] = TO_EXIT;
      if (matrix[x - 1][49] === EXIT) matrix[x][48] = TO_EXIT;
      if (matrix[x][49] === EXIT) matrix[x][48] = TO_EXIT;
      if (matrix[x + 1][49] === EXIT) matrix[x][48] = TO_EXIT;
    }

    // mark Border Tiles as not usable
    for (let y = 1; y < max; y++) {
      matrix[0][y] == UNWALKABLE;
      matrix[49][y] == UNWALKABLE;
    }

    for (let x = 1; x < max; x++) {
      matrix[x][0] == UNWALKABLE;
      matrix[x][49] == UNWALKABLE;
    }

    const room = Game.rooms[roomName];
    if (!room) {
      throw new Error(`RoomMatrix: Room ${roomName} not found`);
    }

    // mark area around sources as unbuildable
    room.find(FIND_SOURCES).forEach(source => {
      getNearbyPositions(source.pos, 2).forEach((pos) => {
        if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
          matrix[pos.x][pos.y] = NO_BUILD;
        }
      });
    });

    // mark area around minerals as unbuildable
    room.find(FIND_MINERALS).forEach(mineral => {
      getNearbyPositions(mineral.pos, 2).forEach((pos) => {
        if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
          matrix[pos.x][pos.y] = NO_BUILD;
        }
      });
    });

    // mark area around controller as unbuildable
    const controller = room.controller;
    getNearbyPositions(controller.pos, 2).forEach((pos) => {
      if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
        matrix[pos.x][pos.y] = NO_BUILD;
      }
    });

    return matrix;
  }
}

export class Edge {
  // vertex_to,res_edge,capacity,flow
  v: number = 0;
  r: number = 0;
  capacity: number = 0;
  flow: number = 0;
}

export class Graph {
  numVertices: number;
  level: number[];
  edges: Edge[][];

  constructor(menge_v: number) {
    this.numVertices = menge_v;

    this.level = Array(menge_v);
    // Array: for every vertex an edge Array mit {v,r,c,f} vertex_to,res_edge,capacity,flow
    this.edges = Array(menge_v).fill(0).map(x => []);
  }

  getTopEdges(x: number, y: number): Edge[] {
    const pos = y * 50 + x;
    return this.edges[pos];
  }

  getBottomEdges(x: number, y: number): Edge[] {
    const pos = y * 50 + x + 2500;
    return this.edges[pos];
  }

  newEdge(u: number, v: number, capacity: number) { // Adds new edge from u to v
    // Normal forward Edge
    this.edges[u].push({v: v, r: this.edges[v].length, capacity, flow: 0});
    // reverse Edge for Residal Graph
    this.edges[v].push({v: u, r: this.edges[u].length - 1, capacity: 0, flow: 0});
  }

  //this.Bfs = function (s, t) { // calculates Level Graph and if theres a path from s to t
  bfs(s: number, t: number) {
    if (t >= this.numVertices) {
      return false;
    }

    this.level.fill(-1); // reset old levels
    this.level[s] = 0;
    let q = []; // queue with s as starting point
    q.push(s);

    let u = 0;
    let edge = null;
    while (q.length) {
      u = q.shift();

      const imax = this.edges[u].length;
      for (let i = 0; i < imax; i++) {
        edge = this.edges[u][i];
        if (this.level[edge.v] < 0 && edge.flow < edge.capacity) {
          this.level[edge.v] = this.level[u] + 1;
          q.push(edge.v);
        }
      }
    }
    return this.level[t] >= 0; // return if theres a path to t -> no level, no path!
  };

  // DFS like: send flow at along path from s->t recursivly while increasing the level of the visited vertices by one
  // u vertex, f flow on path, t =Sink , c Array, c[i] saves the count of edges explored from vertex i
  // this.Dfsflow = function (u, f, t, c) {
  dfsFlow(u, f, t, c) {
    if (u === t) { // Sink reached , aboard recursion
      return f;
    }

    let edge = null;
    let flow_till_here = 0;
    let flow_to_t = 0;
    while (c[u] < this.edges[u].length) { // Visit all edges of the vertex  one after the other
      edge = this.edges[u][c[u]];
      if (this.level[edge.v] === this.level[u] + 1 && edge.flow < edge.capacity) { // Edge leads to Vertex with a level one higher, and has flow left
        flow_till_here = Math.min(f, edge.capacity - edge.flow);
        flow_to_t = this.dfsFlow(edge.v, flow_till_here, t, c);
        if (flow_to_t > 0) {
          edge.flow += flow_to_t; // Add Flow to current edge
          this.edges[edge.v][edge.r].flow -= flow_to_t; // subtract from reverse Edge -> Residual Graph neg. Flow to use backward direction of BFS/DFS
          return flow_to_t;
        }
      }
      c[u]++;
    }
    return 0;
  }

  // breadth-first-search which uses the level array to mark the vertices reachable from s
  // this.Bfsthecut = function (s) {
  bfsTheCut(s): number[] {
    let e_in_cut = [];
    this.level.fill(-1);
    this.level[s] = 1;
    let q = [];
    q.push(s);
    let u = 0;
    let edge = null;
    while (q.length) {
      u = q.shift();
      let i = 0;
      const imax = this.edges[u].length;
      for (; i < imax; i++) {
        edge = this.edges[u][i];
        if (edge.flow < edge.capacity) {
          if (this.level[edge.v] < 1) {
            this.level[edge.v] = 1;
            q.push(edge.v);
          }
        }
        if (edge.flow === edge.capacity && edge.capacity > 0) { // blocking edge -> could be in min cut
          edge.u = u;
          e_in_cut.push(edge);
        }
      }
    }
    let min_cut = [];
    let i = 0;
    const imax = e_in_cut.length;
    for (; i < imax; i++) {
      if (this.level[e_in_cut[i].v] === -1) // Only edges which are blocking and lead to from s unreachable vertices are in the min cut
        min_cut.push(e_in_cut[i].u);
    }
    return min_cut;
  }

  // calculates min-cut graph (Dinic Algorithm)
  // this.Calcmincut = function (s, t) { // calculates min-cut graph (Dinic Algorithm)
  calcMinCut(s, t) {
    if (s == t) {
      return -1;
    }

    let returnvalue = 0;
    let count = [];
    let flow = 0;
    while (this.bfs(s, t) === true) {
      count = Array(this.numVertices + 1).fill(0);
      flow = 0;
      do {
        flow = this.dfsFlow(s, Number.MAX_VALUE, t, count);
        if (flow > 0)
          returnvalue += flow;
      } while (flow)
    }

    return returnvalue;
  }
}

// Removes unneccary cut-tiles if bounds are set to include some 	dead ends
function delete_tiles_to_dead_ends(roomName: string, cut_tiles_array) {
  // Get Terrain and set all cut-tiles as unwalkable
  let room_array = new RoomMatrix(roomName, [], ENTIRE_ROOM_BOUNDS);
  for (let i = cut_tiles_array.length - 1; i >= 0; i--) {
    room_array[cut_tiles_array[i].x][cut_tiles_array[i].y] = UNWALKABLE;
  }
  // Floodfill from exits: save exit tiles in array and do a bfs-like search
  let unvisited_pos = [];
  let y = 0; const max = 49;
  for (; y < max; y++) {
    if (room_array[1][y] === TO_EXIT) unvisited_pos.push(50 * y + 1)
    if (room_array[48][y] === TO_EXIT) unvisited_pos.push(50 * y + 48)
  }
  let x = 0;
  for (; x < max; x++) {
    if (room_array[x][1] === TO_EXIT) unvisited_pos.push(50 + x)
    if (room_array[x][48] === TO_EXIT) unvisited_pos.push(2400 + x) // 50*48=2400
  }
  // Iterate over all unvisited TO_EXIT- Tiles and mark neigbours as TO_EXIT tiles, if walkable (NORMAL), and add to unvisited
  let surr = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];
  let index, dx, dy;
  while (unvisited_pos.length > 0) {
    index = unvisited_pos.pop();
    x = index % 50;
    y = Math.floor(index / 50);
    for (let i = 0; i < 8; i++) {
      dx = x + surr[i][0];
      dy = y + surr[i][1];
      if (room_array[dx][dy] === NORMAL) {
        unvisited_pos.push(50 * dy + dx);
        room_array[dx][dy] = TO_EXIT;
      }
    }
  }
  // Remove min-Cut-Tile if there is no TO-EXIT  surrounding it
  let leads_to_exit = false;
  for (let i = cut_tiles_array.length - 1; i >= 0; i--) {
    leads_to_exit = false;
    x = cut_tiles_array[i].x;
    y = cut_tiles_array[i].y;
    for (let i = 0; i < 8; i++) {
      dx = x + surr[i][0];
      dy = y + surr[i][1];
      if (room_array[dx][dy] === TO_EXIT) {
        leads_to_exit = true;
      }
    }
    if (!leads_to_exit) {
      cut_tiles_array.splice(i, 1);
    }
  }
}

const infini = Number.MAX_VALUE;
const surr = [[0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1]];

// Function to create Source, Sink, Tiles arrays: takes a rectangle-Array as input for Tiles that are to Protect
// rects have top-left/bot_right Coordinates {x1,y1,x2,y2}
function create_graph(roomName: string, protect: Rectangle[], bounds: Rectangle): [Graph, RoomMatrix] {
  // An Array with Terrain information: -1 not usable, 2 Sink (Leads to Exit)
  let roomMatrix = new RoomMatrix(roomName, protect, bounds);

  // initialise graph
  // possible 2*50*50 +2 (st) Vertices (Walls etc set to unused later)
  let g = new Graph(2 * 50 * 50 + 2);

  // per Tile (0 in Array) top + bot with edge of c=1 from top to bott  (use every tile once!)
  // infini edge from bot to top vertices of adjacent tiles if they not protected (array =1) (no reverse edges in normal graph)
  // per prot. Tile (1 in array) Edge from source to this tile with infini cap.
  // per exit Tile (2in array) Edge to sink with infini cap.
  // source is at  pos 2*50*50, sink at 2*50*50+1 as first tile is 0,0 => pos 0
  // top vertices <-> x,y : v=y*50+x   and x= v % 50  y=v/50 (math.floor?)
  // bot vertices <-> top + 2500
  let source = 2 * 50 * 50;
  let sink = 2 * 50 * 50 + 1;
  const max = 49;
  for (let x = 1; x < max; x++) {
    for (let y = 1; y < max; y++) {
      let top = y * 50 + x;
      let bot = top + 2500;
      const vertex = roomMatrix.get(x, y);

      if (vertex === NORMAL) { // normal Tile
        g.newEdge(top, bot, 1);
        for (let i = 0; i < 8; i++) {
          let dx = x + surr[i][0];
          let dy = y + surr[i][1];
          const surroundingVertex = roomMatrix.get(dx, dy)
          if (surroundingVertex === NORMAL || surroundingVertex === TO_EXIT || surroundingVertex === NO_BUILD) {
            g.newEdge(bot, dy * 50 + dx, infini);
          }
        }
      } else if (vertex === PROTECTED) { // protected Tile
        g.newEdge(source, top, infini);
        g.newEdge(top, bot, 1);
        for (let i = 0; i < 8; i++) {
          let dx = x + surr[i][0];
          let dy = y + surr[i][1];
          const surroundingVertex = roomMatrix.get(dx, dy)
          if (surroundingVertex === NORMAL || surroundingVertex === TO_EXIT || surroundingVertex === NO_BUILD) {
            g.newEdge(bot, dy * 50 + dx, infini);
          }
        }
      } else if (vertex === NO_BUILD) {
        g.newEdge(top, bot, infini);
        for (let i = 0; i < 8; i++) {
          let dx = x + surr[i][0];
          let dy = y + surr[i][1];
          const surroundingVertex = roomMatrix.get(dx, dy)
          if (surroundingVertex === NORMAL || surroundingVertex === TO_EXIT || surroundingVertex === NO_BUILD) {
            g.newEdge(bot, dy * 50 + dx, infini);
          }
        }
      } else if (vertex === TO_EXIT) { // near Exit
        g.newEdge(top, sink, infini);
      }
    }
  } // graph finished

  return [g, roomMatrix];
}

// Function for user: calculate min cut tiles from room, rect[]
export function getCutTiles(roomName, rect, bounds): [RoomPosition[], RoomMatrix, Graph] {
  let [graph, matrix] = create_graph(roomName, rect, bounds);

  console.log("graph", JSON.stringify(graph));

  let source = 2 * 50 * 50; // Position Source / Sink in Room-Graph
  let sink = 2 * 50 * 50 + 1;
  let count = graph.calcMinCut(source, sink);

  console.log('NUmber of Tiles in Cut:', count);

  let positions = [];
  if (count > 0) {
    let cut_edges = graph.bfsTheCut(source);
    // Get Positions from Edge
    let u, x, y;

    const imax = cut_edges.length;
    for (let i = 0; i < imax; i++) {
      u = cut_edges[i];// x= v % 50  y=v/50 (math.floor?)
      x = u % 50;
      y = Math.floor(u / 50);
      positions.push({"x": x, "y": y});
    }
  }

  // if bounds are given,
  // try to dectect islands of walkable tiles, which are not conntected to the exits, and delete them from the cut-tiles
  let whole_room = (bounds.x1 == 0 && bounds.y1 == 0 && bounds.x2 == 49 && bounds.y2 == 49);
  if (positions.length > 0 && !whole_room) {
    delete_tiles_to_dead_ends(roomName, positions);
  }

  return [positions, matrix, graph];
}
