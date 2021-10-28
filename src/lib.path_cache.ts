import {FindPathPolicy, getPath} from "./lib.pathing";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";


const CACHE_ITEM_TTL = 1000;

export class PathCacheItem {
  originId: string
  goalId: string
  value: PathFinderPath
  time: number

  next: PathCacheItem
  prev: PathCacheItem

  constructor(originId: string, goalId: string, path: PathFinderPath, time: number) {
    this.originId = originId;
    this.goalId = goalId;
    this.value = path;
    this.time = time;

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
  maxSize: number
  listCount: number
  originGoalToPathMap: {[originKey: string]: {[destKey: string]: PathCacheItem}}
  head: PathCacheItem
  tail: PathCacheItem
  hits: number
  misses: number

  constructor(kingdom, maxSize) {
    this.kingdom = kingdom;
    this.maxSize = maxSize;
    this.listCount = 0;
    this.originGoalToPathMap = {};
    this.hits = 0;
    this.misses = 0;

    this.head = new PathCacheItem(null, null, null, null);
    this.tail = new PathCacheItem(null, null, null, null);
    this.head.add(this.tail);
  }
  loadFromMemory(trace) {
    trace = trace.begin('load_from_memory');

    const memory = Memory['path_cache'] || {};
    const paths = memory.paths || [];
    const rooms = memory.rooms || [];

    paths.forEach((path) => {
      path.value.path = path.value.path.map((position) => {
        return new RoomPosition(position.x, position.y, position.roomName);
      });

      this.setCachedPath(path.originId, path.goalId, path.value, path.time);
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
  setCachedPath(originKey: string, destKey: string, value: PathFinderPath, time: number): PathCacheItem {
    const item = new PathCacheItem(originKey, destKey, value, time);
    this.head.add(item);

    // Add path to cache
    const origins = this.originGoalToPathMap[originKey];
    if (!origins) {
      this.originGoalToPathMap[originKey] = {};
    }

    this.originGoalToPathMap[originKey][destKey] = item;
    this.listCount += 1;

    return item;
  }
  setCachedRoom() {

  }
  getKey(pos, range = 0) {
    return `${pos.roomName}_${pos.x}_${pos.y}_${range}`;
  }

  getCachedPath(originKey: string, destKey: string): PathCacheItem {
    const destinations = this.originGoalToPathMap[originKey];
    if (!destinations) {
      return null;
    }

    const item = destinations[destKey];
    if (!item) {
      return null;
    }

    if (item && item.isExpired(Game.time)) {
      item.remove();
      this.listCount -= 1;
      return null;
    }

    return item;
  }

  getPath(origin: RoomPosition, goal: RoomPosition, range: number, policy: FindPathPolicy,
    trace: Tracer): PathFinderPath {
    const originId = this.getKey(origin, 0);
    const goalId = this.getKey(goal, range);

    let item = this.getCachedPath(originId, goalId);

    // If no item, calculate path; otherwise, move item to top of LRU cache
    if (!item) {
      this.misses += 1;

      const result = getPath(this.kingdom, origin, goal, policy, trace);
      if (!result) {
        return null;
      }

      const path = result.path;

      item = this.setCachedPath(originId, goalId, result, Game.time);
    } else {
      item.remove();
      this.head.add(item);
      this.hits += 1;
    }

    if (this.listCount > this.maxSize) {
      const toRemove = this.tail.next;
      if (toRemove) {
        if (!this.originGoalToPathMap[toRemove.originId] ||
          !this.originGoalToPathMap[toRemove.originId][toRemove.goalId]) {
          return null;
        }

        delete this.originGoalToPathMap[toRemove.originId][toRemove.goalId];
        toRemove.remove();
        this.listCount -= 1;
      }
    }

    return item.value;
  }

  getSize() {
    let count = 0;
    let node = this.head;
    while (node.prev) {
      if (node.prev === node) {
        console.log('aborting, hit self referencing node')
        break;
      }

      if (node.prev.prev === node) {
        console.log('aborting, hit cyclical (3) referencing node')
        break;
      }

      if (count > 1000) {
        console.log('aborting count, too large')
        break;
      }

      count++;
      node = node.prev;
    }

    return count;
  }

  getStats() {
    return {
      cacheHits: this.hits,
      cacheMisses: this.misses,
      listCount: this.listCount,
      size: this.getSize(),
    };
  }
}

// Lifted from https://github.com/bonzaiferroni/Traveler/blob/f1ab751b607a62b92d63852f7d157351e3132e39/Traveler.ts#L542
const serializePath = (startPos, path) => {
  let serializedPath = '';
  let lastPosition = startPos;
  for (const position of path) {
    serializedPath += lastPosition.getDirectionTo(position);
    lastPosition = position;
  }

  return serializedPath;
};

