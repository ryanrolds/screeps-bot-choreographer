

class PathCacheItem {
  constructor(originId, goalId, path) {
    this.originId = originId;
    this.goalId = goalId;
    this.value = path;

    this.next = null;
    this.prev = null;
  }
  add(prev) {
    if (prev.next) {
      this.next = prev.next;
      this.next.prev = this;
    }

    this.prev = prev;
    this.prev.next = this;
  }
  remove() {
    this.next.prev = this.prev;
    this.prev.next = this.next;
  }
  increment() {
    if (!this.next) {
      return;
    }

    const newNext = this.next.next;
    const newPrev = this.next;

    const oldPrev = this.prev;

    if (newNext) {
      newNext.prev = this;
      this.next = newNext;
    }

    newPrev.next = this;
    newPrev.prev = this.prev;
    this.prev = newPrev;

    oldPrev.next = newPrev;
  }
}

class PathCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.listCount = 0;
    this.linkedList = new PathCacheItem();
    this.originGoalToPathMap = {};
  }
  get(origin, goal) {
    const originGoals = this.originGoalToPathMap[origin.id];
    if (!originGoals) {
      this.originGoalToPathMap[origin.id] = {};
    }

    let item = this.originGoalToPathMap[origin.id][goal.id];
    if (!item) {
      // Calculate new path
      const path = origin.findPathTo(goal, {ignoreCreeps: true});

      item = new PathCacheItem(origin.id, goal.id, path);
      item.add(this.linkedList);

      // Add path to cache
      this.originGoalToPathMap[origin.id][goal.id] = item;
      this.listCount += 1;
    }

    if (item) {
      item.increment();
    }

    if (this.listCount > this.maxSize) {
      const toRemove = this.linkedList.next;
      delete this.originGoalToPathMap[toRemove.originId][toRemove.goalId];
      toRemove.remove();
      this.listCount += 1;
    }

    return item.value;
  }
}

const pathCache = new PathCache(250);

module.exports.getPath = (origin, goal) => {
  return pathCache.get(origin, goal);
};
