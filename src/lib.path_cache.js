const featureFlags = require('./lib.feature_flags');

const COST_MATRIX_TTL = 1000;
const CACHE_ITEM_TTL = 1000;

class PathCacheItem {
  constructor(originId, goalId, path, time) {
    this.originId = originId;
    this.goalId = goalId;
    this.value = path;
    this.time = time;

    this.next = null;
    this.prev = null;
  }
  add(item) {
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
  isExpired(time) {
    return time - this.time > CACHE_ITEM_TTL;
  }
}

class RoomCostMatrix {
  constructor(room) {
    this.roomId = room.name;
    this.room = room;
    this.costMatrix = null;
    this.time = 0;
  }
  update() {
    const costMatrix = new PathFinder.CostMatrix();

    this.room.find(FIND_STRUCTURES).forEach(function(struct) {
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

class PathCache {
  constructor(kingdom, maxSize) {
    this.kingdom = kingdom;
    this.maxSize = maxSize;
    this.listCount = 0;
    this.originGoalToPathMap = {};
    this.hits = 0;
    this.misses = 0;
    this.rooms = {};

    this.head = new PathCacheItem();
    this.tail = new PathCacheItem();
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

    rooms.forEach((room) => {

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
  setCachedPath(originKey, destKey, value, time) {
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
  getCachedPath(originKey, destKey) {
    const destinations = this.originGoalToPathMap[originKey];
    if (!destinations) {
      return null;
    }

    const item = destinations[destKey];
    if (!item) {
      return null;
    }

    return item.value;
  }
  getPath(origin, goal, range, ignoreCreeps = true) {
    const originId = this.getKey(origin, 0);
    const goalId = this.getKey(goal, range);

    const originGoals = this.originGoalToPathMap[originId];
    if (!originGoals) {
      this.originGoalToPathMap[originId] = {};
    }

    let item = this.originGoalToPathMap[originId][goalId];

    if (item && item.isExpired(Game.time)) {
      item.remove();
      this.listCount -= 1;
      item = null;
    }

    if (!item) {
      this.misses += 1;

      let path = null;
      // Calculate new path
      if (featureFlags.getFlag(featureFlags.USE_PATH_SEARCH)) {
        const opts = {
          plainCost: 2,
          swampCost: 10,
          roomCallback: (roomName) => {
            let room = this.rooms[roomName];
            if (!room) {
              const roomEntity = Game.rooms[roomName];
              if (!roomEntity) {
                // Return empty cost matrix
                return new PathFinder.CostMatrix();
              }

              room = new RoomCostMatrix(roomEntity);
              this.rooms[roomName] = room;
            }

            const costMatrix = room.getCostMatrix();
            return costMatrix;
          },
        };

        const result = PathFinder.search(origin, {pos: goal, range}, opts);


        // TODO if incompletely try cutting some off the path to avoid getting stuck

        path = result.path;
      } else {
        path = origin.findPathTo(goal, {ignoreCreeps});
      }

      const serializedPath = serializePath(origin, path);
      item = this.setCachedPath(originId, goalId, {serializedPath, path}, Game.time);
    } else {
      item.remove();
      this.head.add(item);

      this.hits += 1;
    }

    if (this.listCount > this.maxSize) {
      const toRemove = this.tail.next;
      delete this.originGoalToPathMap[toRemove.originId][toRemove.goalId];
      toRemove.remove();
      this.listCount -= 1;
    }

    return item.value;
  }
  getSize() {
    let count = 0;
    let node = this.head;
    while (node.prev) {
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

module.exports = PathCache;
