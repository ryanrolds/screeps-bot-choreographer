import {FindPathPolicy, getPath} from "./lib.pathing";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";


export const CACHE_ITEM_TTL = 1000;

export type PathProvider = (kingdrom: Kingdom, origin: RoomPosition, goal: RoomPosition,
  policy: FindPathPolicy, trace: Tracer) => PathFinderPath;

export class PathCacheItem {
  originId: string
  goalId: string
  value: PathFinderPath
  time: number
  hits: number

  next: PathCacheItem
  prev: PathCacheItem

  constructor(originId: string, goalId: string, path: PathFinderPath, time: number) {
    this.originId = originId;
    this.goalId = goalId;
    this.value = path;
    this.time = time;
    this.hits = 0;

    this.next = null;
    this.prev = null;
  }

  add(item: PathCacheItem) {
    if (this.prev) {
      this.prev.next = item;
      item.prev = this.prev;
    }

    this.prev = item;
    item.next = this;
  }

  remove() {
    this.next.prev = this.prev;
    this.prev.next = this.next;
  }

  isExpired(time: number) {
    return time - this.time > CACHE_ITEM_TTL;
  }
}

export class PathCache {
  kingdom: Kingdom
  pathProvider: PathProvider

  maxSize: number
  listCount: number

  originGoalToPathMap: {[originKey: string]: {[destKey: string]: PathCacheItem}}
  head: PathCacheItem
  tail: PathCacheItem

  hits: number
  misses: number
  expired: number

  constructor(kingdom: Kingdom, maxSize: number, pathProvider: PathProvider) {
    this.kingdom = kingdom;
    this.pathProvider = pathProvider;

    this.maxSize = maxSize;
    this.listCount = 0;

    this.originGoalToPathMap = {};
    this.head = new PathCacheItem(null, null, null, null);
    this.tail = new PathCacheItem(null, null, null, null);
    this.head.add(this.tail);

    this.hits = 0;
    this.misses = 0;
    this.expired = 0;
  }

  getPath(origin: RoomPosition, goal: RoomPosition, range: number, policy: FindPathPolicy,
    trace: Tracer): PathFinderPath {
    const originId = this.getKey(origin, 0);
    const goalId = this.getKey(goal, range);

    let item = this.getCachedPath(originId, goalId, trace);

    // If no item, calculate path; otherwise, move item to top of LRU cache
    if (!item) {
      //trace.log('cache miss: calculating path', {origin, goal});

      const getPolicy = _.cloneDeep(policy);
      getPolicy.destination.range = range;

      const result = this.pathProvider(this.kingdom, origin, goal, getPolicy, trace);
      if (!result) {
        return null;
      }

      item = this.setCachedPath(originId, goalId, result, Game.time, trace);
    }

    return item.value;
  }

  setCachedPath(originKey: string, destKey: string, value: PathFinderPath, time: number,
    trace: Tracer): PathCacheItem {
    const item = new PathCacheItem(originKey, destKey, value, time);
    this.head.add(item);
    this.listCount += 1;

    // Add path to cache
    const origins = this.originGoalToPathMap[originKey];
    if (!origins) {
      this.originGoalToPathMap[originKey] = {};
    }

    this.originGoalToPathMap[originKey][destKey] = item;

    trace.notice('set cache path', {originKey, destKey});

    if (this.listCount > this.maxSize) {
      const toRemove = this.tail.next;

      trace.notice('over max', {
        count: this.listCount,
        max: this.maxSize,
        originKey: toRemove.originId,
        destKey: toRemove.goalId
      });

      if (toRemove && this.originGoalToPathMap[toRemove.originId]) {
        delete this.originGoalToPathMap[toRemove.originId][toRemove.goalId];
        toRemove.remove();
        this.listCount -= 1;
      }
    }

    return item;
  }

  getCachedPath(originKey: string, destKey: string, trace: Tracer): PathCacheItem {
    const destinations = this.originGoalToPathMap[originKey];
    if (!destinations) {
      this.misses += 1;
      return null;
    }

    const item = destinations[destKey];
    if (!item) {
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    item.hits += 1;

    item.remove();
    this.listCount -= 1;

    if (item.isExpired(Game.time)) {
      this.expired += 1;
      return null;
    }

    this.head.add(item);
    this.listCount += 1;

    return item;
  }

  getKey(pos, range = 0) {
    return `${pos.roomName}_${pos.x}_${pos.y}_${range}`;
  }

  getSize(trace: Tracer) {
    let count = 0;
    let node = this.head;
    while (node.prev) {
      if (node.prev === node) {
        trace.notice('aborting, hit self referencing node')
        break;
      }

      if (node.prev.prev === node) {
        trace.notice('aborting, hit cyclical (3) referencing node')
        break;
      }

      if (count > this.maxSize * 1.1) {
        trace.notice('aborting count, too large')
        break;
      }

      if (node.value) {
        count++;
      }

      node = node.prev;
    }

    return count;
  }

  loadFromMemory(trace) {
    trace = trace.begin('load_from_memory');

    const memory = Memory['path_cache'] || {};
    const paths = memory.paths || [];

    paths.forEach((path) => {
      path.value.path = path.value.path.map((position) => {
        return new RoomPosition(position.x, position.y, position.roomName);
      });

      this.setCachedPath(path.originId, path.goalId, path.value, path.time, trace);
    });

    trace.end();
  }

  saveToMemory(trace) {
    trace = trace.begin('save_to_memory');

    const paths = [];
    let path = this.tail;
    while (path = path.next) {
      if (!path.value) {
        continue;
      }

      paths.push({
        originId: path.originId,
        goalId: path.goalId,
        value: {
          path: path.value.path.map((pos) => {
            return {
              x: pos.x,
              y: pos.y,
              roomName: pos.roomName,
            };
          }),
        },
        time: path.time,
      });
    }

    const rooms = [];

    Memory['path_cache'] = {
      paths,
      rooms,
    };

    trace.end();
  }

  getStats(trace: Tracer) {
    return {
      cacheHits: this.hits,
      cacheMisses: this.misses,
      listCount: this.listCount,
      size: this.getSize(trace),
    };
  }

  debug() {
    console.log(this.listCount);
    let node = this.head;
    while (node.prev) {
      console.log(node.originId, node.goalId, node.hits, Game.time - node.time, node?.value?.path.length);
      node = node.prev;
    }
  }
}
