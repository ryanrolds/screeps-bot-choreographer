import {commonPolicy} from '../constants/pathing_policies';
import {warPartyQuadPolicy, warPartySingleFilePolicy} from '../creeps/party/attack';
import {Metrics} from '../lib/metrics';
import {FindPathPolicy, getPath, PathSearchDetails, visualizePath} from '../lib/pathing';
import {Tracer} from '../lib/tracing';
import {BufferPathPolicy} from '../managers/buffer';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, running} from '../os/process';

export default class PathDebugger {
  id: string;
  results: PathFinderPath;
  resultsDebug: PathSearchDetails;
  kernel: Kernel;

  constructor(id: string, kernel: Kernel) {
    this.id = id;
    this.results = null;
    this.resultsDebug = null;
    this.kernel = kernel;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace.info('path debugger', {path: this.results});

    if (this.results) {
      visualizePath(this.results.path, trace);

      for (const roomName of this.resultsDebug.searchedRooms) {
        if (this.resultsDebug.blockedRooms.has(roomName)) {
          Game.map.visual.text('X', new RoomPosition(25, 25, roomName), {color: '#ff0000'});
          return;
        }

        Game.map.visual.text('0', new RoomPosition(25, 25, roomName), {color: '#ff0000'});
      }

      _.each(this.resultsDebug.incompletePaths, (path) => {
        displayRoomPaths(path.path, {stroke: '#ff0000'});
        Game.map.visual.poly(path.path, {stroke: '#ff0000'});
      });
    }

    return running();
  }

  debug(origin: RoomPosition, goal: RoomPosition, range: number, policyName: string) {
    const trace = new Tracer('path_debugger_debug', new Map([['pid', 'path_debugger']]), new Metrics());
    trace.setLogFilter(global.LOG_WHEN_PID);

    let policy: FindPathPolicy = null;
    switch (policyName) {
      case 'warparty_quad':
        policy = warPartyQuadPolicy;
        break;
      case 'warparty_single_file':
        policy = warPartySingleFilePolicy;
        break;
      case 'buffer_path':
        policy = BufferPathPolicy;
        break;
      case 'common':
        policy = commonPolicy;
        break;
      default:
        trace.error('policy not supported', {policyName});
        return;
    }

    const [path, debug] = getPath(this.kernel, origin, goal, policy, trace);

    trace.notice('path', {origin, goal, range, policy, path, debug});
    this.results = path;
    this.resultsDebug = debug;
  }

  clear() {
    this.results = null;
  }
}

export const displayRoomPaths = (path: RoomPosition[], style: PolyStyle) => {
  const pathByRooms = path.reduce((acc, pos) => {
    if (!acc.has(pos.roomName)) {
      acc.set(pos.roomName, []);
    }

    acc.get(pos.roomName).push(pos)
    return acc;
  }, new Map<string, RoomPosition[]>());

  // Display in the rooms
  Array.from(pathByRooms.entries()).forEach(([key, value]) => {
    new RoomVisual(key).poly(value, style);
  });
};
