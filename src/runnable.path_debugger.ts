import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {FindPathPolicy, getPath, PathSearchDetails} from "./lib.pathing";
import {warPartyPolicy} from "./runnable.warparty";
import {commonPolicy} from "./lib.pathing_policies";

export default class PathDebugger {
  id: string;
  results: PathFinderPath;
  resultsDebug: PathSearchDetails;
  kingdom: Kingdom;

  constructor(id: string, kingdom: Kingdom) {
    this.id = id;
    this.results = null;
    this.resultsDebug = null;
    this.kingdom = kingdom;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace.log("path debugger", {path: this.results})

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

      _.each(this.resultsDebug.searchedRooms, (blocked, roomName) => {
        if (this.resultsDebug.blockedRooms[roomName]) {
          Game.map.visual.text('X', new RoomPosition(25, 25, roomName), {color: '#ff0000'});
          return;
        }

        Game.map.visual.text('0', new RoomPosition(25, 25, roomName), {color: '#ff0000'});
      });

      _.each(this.resultsDebug.incompletePaths, (path) => {
        Game.map.visual.poly(path.path, {stroke: '#ff0000'});
      });

      Game.map.visual.poly(this.results.path, {stroke: '#ffffff'});
    }

    return running();
  }

  debug(origin: RoomPosition, goal: RoomPosition, range: number, policyName: string) {
    const trace = new Tracer('path_debugger_debug', {}, 0);

    let policy: FindPathPolicy = null;
    switch (policyName) {
      case 'warparty':
        policy = warPartyPolicy;
        break;
      case 'common':
        policy = commonPolicy
        break;
      default:
        trace.error('policy not supported', {policyName});
        return;
    }

    const [path, debug] = getPath(this.kingdom, origin, goal, policy, trace);

    trace.notice('path', {origin, goal, range, policy, path, debug});
    this.results = path;
    this.resultsDebug = debug;
  }

  clear() {
    this.results = null;
  }
}
