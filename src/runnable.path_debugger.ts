import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {PathFinderPolicy} from "./lib.path_cache";

export default class PathDebugger {
  id: string;
  results: PathFinderPath;
  kingdom: Kingdom;

  constructor(id: string, kingdom: Kingdom) {
    this.id = id;
    this.results = null;
    this.kingdom = kingdom;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace.log("path bebugger", {path: this.results})

    if (this.results) {
      // Display on the map
      Game.map.visual.poly(this.results.path);


      const pathByRooms = this.results.path.reduce((acc, pos) => {
        if (!acc[pos.roomName]) {
          acc[pos.roomName] = [];
        }

        acc[pos.roomName].push(pos);

        return acc;
      }, {} as Record<string, RoomPosition[]>);

      // Display in the rooms
      Object.entries(pathByRooms).forEach(([key, value]) => {
        new RoomVisual(key).poly(value);
      });
    }

    return running();
  }

  debug(origin: RoomPosition, goal: RoomPosition, range: number, policy: PathFinderPolicy) {
    const trace = new Tracer('debug', 'path_debugger.debug')
    const path = this.kingdom.getPathCache().calculatePath(origin, goal, range, policy, trace);

    trace.notice('path', {origin, goal, range, policy, path});
    this.results = path;
  }

  clear() {
    this.results = null;
  }
}
