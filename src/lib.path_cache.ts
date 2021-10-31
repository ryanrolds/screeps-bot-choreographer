import {stringify} from "querystring";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";

const COST_MATRIX_TTL = 1000;
const CACHE_ITEM_TTL = 1000;

export type PathFinderPolicy = {
  avoidHostiles: boolean;
  avoidOwnedRooms: boolean;
  avoidFriendlyRooms: boolean;
  maxOps: number;
};

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

class RoomCostMatrix {
  roomId: string
  room: Room
  costMatrix: CostMatrix
  time: number

  constructor(room) {
    this.roomId = room.name;
    this.room = room;
    this.costMatrix = null;
    this.time = 0;
  }
  update() {
    const costMatrix = new PathFinder.CostMatrix();

    this.room.find(FIND_STRUCTURES).forEach(function (struct) {
      if (struct.structureType === STRUCTURE_ROAD) {
        // Favor roads over plain tiles
        costMatrix.set(struct.pos.x, struct.pos.y, 1);
      } else if (struct.structureType !== STRUCTURE_CONTAINER &&
        (struct.structureType !== STRUCTURE_RAMPART || !struct.my)) {
        // Can't walk through non-walkable buildings
        costMatrix.set(struct.pos.x, struct.pos.y, 255);
      }
    });

    // TODO avoid sources
    // TODO avoid room controllers

    this.costMatrix = costMatrix;
    this.time = Game.time;
  }
  getCostMatrix() {
    if (!this.costMatrix || this.isExpired(Game.time)) {
      this.update();
    }

    return this.costMatrix;
  }
  isExpired(time) {
    return time - this.time > COST_MATRIX_TTL;
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
  rooms: {[roomId: string]: RoomCostMatrix}

  constructor(kingdom, maxSize) {
    this.kingdom = kingdom;
    this.maxSize = maxSize;
    this.listCount = 0;
    this.originGoalToPathMap = {};
    this.hits = 0;
    this.misses = 0;
    this.rooms = {};

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

  getPath(origin: RoomPosition, goal: RoomPosition, range: number, policy: PathFinderPolicy,
    trace: Tracer): PathFinderPath {
    const originId = this.getKey(origin, 0);
    const goalId = this.getKey(goal, range);

    let item = this.getCachedPath(originId, goalId);

    // If no item, calculate path; otherwise, move item to top of LRU cache
    if (!item) {
      this.misses += 1;

      const result = this.calculatePath(origin, goal, range, policy, trace);
      const path = result.path;

      item = this.setCachedPath(originId, goalId, result, Game.time);
    } else {
      item.remove();
      this.head.add(item);

      this.hits += 1;
    }

    if (this.listCount > this.maxSize) {
      const toRemove = this.tail.next;
      if (toRemove && this.originGoalToPathMap[toRemove.originId]) {
        delete this.originGoalToPathMap[toRemove.originId][toRemove.goalId];
        toRemove.remove();
        this.listCount -= 1;
      }
    }

    return item.value;
  }

  calculatePath(origin: RoomPosition, goal: RoomPosition, range: number, policy: PathFinderPolicy,
    trace: Tracer): PathFinderPath {
    // Calculate new path
    const opts = {
      plainCost: 2,
      swampCost: 2,
      maxOps: policy.maxOps,
      roomCallback: (roomName) => {
        let room = this.rooms[roomName];
        if (!room) {
          const roomEntry = this.kingdom.getScribe().getRoomById(roomName);
          trace.log('room_callback', {roomEntry});
          if (roomEntry) {

            if (roomEntry.hasKeepers) {
              trace.log('avoid room with keepers', {roomName});
              return false;
            }

            const friends = this.kingdom.getFriends();
            const owner = roomEntry.controller?.owner;
            trace.log('room check', {roomName, owner, friends, numTowers: roomEntry.numTowers});
            if (owner && owner !== this.kingdom.config.username && friends.indexOf(owner) === -1) {
              trace.log('avoid owned room', {roomName, owner, ttl: Game.time - roomEntry.lastUpdated});
              return false;
            }

            if (!owner && roomEntry.numTowers > 0) {
              trace.log('avoid room with towers', {roomName, numTowers: roomEntry.numTowers});
              return false;
            }
          } else {
            trace.log('room not yet seen', {roomName})
          }

          const roomEntity = Game.rooms[roomName];
          if (!roomEntity) {
            // Return empty cost matrix
            trace.log('using blank cost matrix', {roomName})
            return new PathFinder.CostMatrix();
          }

          trace.log('generating new matrix', {roomName});

          room = new RoomCostMatrix(roomEntity);
          this.rooms[roomName] = room;
        }

        const costMatrix = room.getCostMatrix();
        return costMatrix;
      },
    };

    trace.notice("calculatePath", {origin, goal, range, opts})
    return PathFinder.search(origin, {pos: goal, range}, opts);
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
      roomCacheSize: Object.keys(this.rooms).length,
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

