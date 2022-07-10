import {expect} from 'chai';
import 'mocha';
import {mockGlobal} from 'screeps-test-helper';
import Sinon, * as sinon from 'sinon';
import {AI} from './ai';
import {CreepManager} from './ai.creeps';
import {ShardConfig} from './config';
import {commonPolicy} from './constants.pathing_policies';
import {Kernel} from './kernel';
import {EventBroker} from './lib.event_broker';
import {CACHE_ITEM_TTL, PathCache, PathCacheItem, PathProvider} from './lib.path_cache';
import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {Scheduler} from './os.scheduler';
import {CentralPlanning} from './runnable.central_planning';
import {Scribe} from './runnable.scribe';

describe('Path Cache', function() {
  let sandbox: Sinon.SinonSandbox = null;
  let trace: Tracer = null;
  let kernel: Kernel = null;
  let pathProvider: PathProvider = null;

  const originKey = 'source';
  const destKey = 'target';
  const path = {} as PathFinderPath;
  const otherDestKey = 'other';
  const otherPath = {} as PathFinderPath;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockGlobal<Game>('Game', {
      time: CACHE_ITEM_TTL + 1,
      shard: {
        name: 'test',
      },
      spawns: {},
      cpu: {
        limit: 20,
        tickLimit: 50,
        bucket: 10000,
        getUsed: () => {
          return 0;
        },
      },
    });

    mockGlobal<Memory>('Memory', {}, true);

    trace = new Tracer('test', new Map(), 0);

    const config: ShardConfig = {
      buffer: 0,
      friends: [],
      neutral: [],
      avoid: [],
      kos: [],
      authorizedSieges: [],
      maxColonies: 1,
      autoAttack: false,
      autoExpand: false,
      explorers: true,
    };
    const scheduler = new Scheduler();
    const scribe = new Scribe();
    const broker = new EventBroker();
    const topics = new Topics();
    const planner = new CentralPlanning(config, scheduler, trace);
    const creepsManager = new CreepManager(scheduler);

    kernel = new AI(config, scheduler, trace);

    pathProvider = sandbox.stub().callsFake(() => [path, {}]);
  });

  afterEach(() => {
    sandbox.reset();
  });

  it('should create empty path cache', () => {
    const cache = new PathCache(10, pathProvider);
    expect(cache.getSize(trace)).to.equal(0);
  });

  describe('getPath', () => {
    const origin = new RoomPosition(25, 25, 'N0E0');
    const dest = new RoomPosition(25, 25, 'N0E1');
    const range = 0;
    const policy = commonPolicy;

    it('should calculate path and cache', () => {
      const cache = new PathCache(10, pathProvider);

      const result = cache.getPath(kernel, origin, dest, range, policy, trace);
      expect(result).to.equal(path);
      expect(cache.getSize(trace)).to.equal(1);

      const pathProviderStub = (pathProvider as Sinon.SinonStub);
      expect(pathProviderStub.callCount).to.equal(1);
      const call = pathProviderStub.getCall(0);
      expect(call.args[0]).to.equal(kernel);
      expect(call.args[1]).to.equal(origin);
      expect(call.args[2]).to.equal(dest);
      expect(call.args[3].destination.range).to.equal(range);
      expect(call.args[4]).to.equal(trace);
    });

    it('should only calculate the path once', () => {
      const cache = new PathCache(10, pathProvider);

      let result = cache.getPath(kernel, origin, dest, range, policy, trace);
      expect(result).to.equal(path);

      result = cache.getPath(kernel, origin, dest, range, policy, trace);
      expect(result).to.equal(path);

      expect(cache.getSize(trace)).to.equal(1);

      const pathProviderStub = (pathProvider as Sinon.SinonStub);
      expect(pathProviderStub.callCount).to.equal(1);
    });
  });

  describe('setCachedPath', () => {
    it('should add a path', () => {
      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);
      expect(cache.getSize(trace)).to.equal(1);
    });

    it('should handle two cached paths with same origin', () => {
      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);
      cache.setCachedPath(originKey, otherDestKey, otherPath, CACHE_ITEM_TTL, trace);
      expect(cache.getSize(trace)).to.equal(2);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem.value).to.equal(path);
      const otherCachedItem = cache.getCachedPath(originKey, otherDestKey, trace);
      expect(otherCachedItem.value).to.equal(otherPath);
    });

    it('should limit the number of items in the cache', () => {
      const maxItems = 5;
      const cache = new PathCache(maxItems, pathProvider);

      for (let i = 0; i < 10; i++) {
        cache.setCachedPath(`${originKey}_${i % 3}`, `${destKey}_${i}`, path, CACHE_ITEM_TTL, trace);
      }

      expect(cache.getSize(trace)).to.equal(maxItems);
      expect(cache.listCount).to.equal(maxItems);
    });
  });

  describe('getCachedPath', () => {
    it('should return null if path not cached', () => {
      const cache = new PathCache(10, pathProvider);
      const path = cache.getCachedPath(originKey, destKey, trace);
      expect(path).to.equal(null);
    });

    it('should return cached path', () => {
      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem.originId).to.equal(originKey);
      expect(cachedItem.value).to.equal(path);
    });

    it('should not return cached path that is expired', () => {
      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, 0, trace);
      expect(cache.getSize(trace)).to.equal(1);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem).to.equal(null);
      expect(cache.getSize(trace)).to.equal(0);
    });

    it('should handle first expiring', () => {
      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, 0, trace);
      cache.setCachedPath(originKey, otherDestKey, otherPath, CACHE_ITEM_TTL, trace);
      expect(cache.getSize(trace)).to.equal(2);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem).to.equal(null);
      const otherCachedItem = cache.getCachedPath(originKey, otherDestKey, trace);
      expect(otherCachedItem.value).to.equal(otherPath);

      expect(cache.getSize(trace)).to.equal(1);
    });

    it('should handle last expiring', () => {
      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);
      cache.setCachedPath(originKey, otherDestKey, otherPath, 0, trace);
      expect(cache.getSize(trace)).to.equal(2);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem.value).to.equal(path);
      const otherCachedItem = cache.getCachedPath(originKey, otherDestKey, trace);
      expect(otherCachedItem).to.equal(null);

      expect(cache.getSize(trace)).to.equal(1);
    });

    it('should handle middle expiring', () => {
      const anotherDestKey = 'another';
      const anotherPath = {} as PathFinderPath;

      const cache = new PathCache(10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);
      cache.setCachedPath(originKey, anotherDestKey, anotherPath, 0, trace);
      cache.setCachedPath(originKey, otherDestKey, otherPath, CACHE_ITEM_TTL, trace);
      expect(cache.getSize(trace)).to.equal(3);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem.value).to.equal(path);
      const anotherCachedItem = cache.getCachedPath(originKey, anotherDestKey, trace);
      expect(anotherCachedItem).to.equal(null);
      const otherCachedItem = cache.getCachedPath(originKey, otherDestKey, trace);
      expect(otherCachedItem.value).to.equal(otherPath);

      expect(cache.getSize(trace)).to.equal(2);
    });
  });

  describe('detailed linked list tests', () => {
    it('should correctly update the linked list', () => {
      const head = new PathCacheItem(null, null, null, Game.time);
      const tail = new PathCacheItem(null, null, null, Game.time);
      head.add(tail);

      expect(head.prev).to.equal(tail);
      expect(head.next).to.equal(null);
      expect(tail.next).to.equal(head);
      expect(tail.prev).to.equal(null);

      const newNode = new PathCacheItem(null, null, null, Game.time);
      head.add(newNode);

      expect(head.prev).to.equal(newNode);
      expect(head.next).to.equal(null);
      expect(newNode.next).to.equal(head);
      expect(newNode.prev).to.equal(tail);
      expect(tail.next).to.equal(newNode);
      expect(tail.prev).to.equal(null);

      tail.next.remove();

      expect(head.prev).to.equal(tail);
      expect(head.next).to.equal(null);
      expect(tail.next).to.equal(head);
      expect(tail.prev).to.equal(null);

      const anotherNode = new PathCacheItem(null, null, null, Game.time);
      head.add(anotherNode);

      const yetAnotherNode = new PathCacheItem(null, null, null, Game.time);
      head.add(yetAnotherNode);

      const andAnotherNode = new PathCacheItem(null, null, null, Game.time);
      head.add(andAnotherNode);

      yetAnotherNode.remove();
      head.add(yetAnotherNode);

      expect(head.prev).to.equal(yetAnotherNode);
      expect(yetAnotherNode.prev).to.equal(andAnotherNode);
      expect(andAnotherNode.prev).to.equal(anotherNode);
      expect(anotherNode.prev).to.equal(tail);
      expect(tail.prev).to.equal(null);

      expect(tail.next).to.equal(anotherNode);
      expect(anotherNode.next).to.equal(andAnotherNode);
      expect(andAnotherNode.next).to.equal(yetAnotherNode);
      expect(yetAnotherNode.next).to.equal(head);
      expect(head.next).to.equal(null);
    });
  });
});
