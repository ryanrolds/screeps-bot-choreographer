import 'mocha';
import {expect} from 'chai';
import * as _ from "lodash";
import Sinon, * as sinon from 'sinon';
import {stubObject, StubbedInstance} from "ts-sinon";
import {setup, mockGlobal, mockInstanceOf} from "screeps-test-helper";
import {CACHE_ITEM_TTL, PathCache, PathProvider} from './lib.path_cache';
import {Kingdom} from './org.kingdom';
import {Scheduler} from './os.scheduler';
import {KingdomConfig} from './config';
import {Tracer} from './lib.tracing';
import {common} from './lib.pathing_policies';

describe('Path Cache', function () {
  let sandbox: Sinon.SinonSandbox = null;
  let trace: Tracer = null;
  let kingdom: Kingdom = null;
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
        name: 'shard0',
      },
      cpu: {
        limit: 20,
        tickLimit: 50,
        bucket: 10000,
        getUsed: () => {
          return 0;
        }
      },
    });

    mockGlobal<Memory>('Memory', {
      scribe: undefined,
    });

    const config: KingdomConfig = {} as KingdomConfig;
    const scheduler = new Scheduler();
    trace = new Tracer('test', 'test');
    kingdom = new Kingdom(config, scheduler, trace);

    pathProvider = sandbox.stub().callsFake(() => path);
  });

  afterEach(() => {
    sandbox.reset();
  })

  it('should create empty path cache', () => {
    const cache = new PathCache(kingdom, 10, pathProvider);
    expect(cache.getSize(trace)).to.equal(0);
  });

  describe('getPath', () => {
    const origin = new RoomPosition(25, 25, 'N0E0');
    const dest = new RoomPosition(25, 25, 'N0E1');
    const range = 0;
    const policy = common;

    it('should calculate path and cache', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);

      const result = cache.getPath(origin, dest, range, policy, trace);
      expect(result).to.equal(path);
      expect(cache.getSize(trace)).to.equal(1);

      const pathProviderStub = (pathProvider as Sinon.SinonStub)
      expect(pathProviderStub.callCount).to.equal(1);
      const call = pathProviderStub.getCall(0);
      expect(call.args[0]).to.equal(kingdom);
      expect(call.args[1]).to.equal(origin);
      expect(call.args[2]).to.equal(dest);
      expect(call.args[3].destination.range).to.equal(range);
      expect(call.args[4]).to.equal(trace);
    });

    it('should only calculate the path once', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);

      let result = cache.getPath(origin, dest, range, policy, trace);
      expect(result).to.equal(path);

      result = cache.getPath(origin, dest, range, policy, trace);
      expect(result).to.equal(path);

      expect(cache.getSize(trace)).to.equal(1);

      const pathProviderStub = (pathProvider as Sinon.SinonStub)
      expect(pathProviderStub.callCount).to.equal(1);
    });
  });

  describe('setCachedPath', () => {
    it('should add a path', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);
      expect(cache.getSize(trace)).to.equal(1);
    });

    it('should handle two cached paths with same origin', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);
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
      const cache = new PathCache(kingdom, maxItems, pathProvider);

      for (let i = 0; i < 10; i++) {
        cache.setCachedPath(`${originKey}_${i % 3}`, `${destKey}_${i}`, path, CACHE_ITEM_TTL, trace);
        console.log(cache.listCount)
      }

      expect(cache.getSize(trace)).to.equal(maxItems);
      expect(cache.listCount).to.equal(maxItems);
    });
  });

  describe('getCachedPath', () => {
    it('should return null if path not cached', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);
      const path = cache.getCachedPath(originKey, destKey, trace);
      expect(path).to.equal(null);
    });

    it('should return cached path', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, CACHE_ITEM_TTL, trace);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem.originId).to.equal(originKey);
      expect(cachedItem.value).to.equal(path);
    });

    it('should not return cached path that is expired', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);
      cache.setCachedPath(originKey, destKey, path, 0, trace);
      expect(cache.getSize(trace)).to.equal(1);

      const cachedItem = cache.getCachedPath(originKey, destKey, trace);
      expect(cachedItem).to.equal(null);
      expect(cache.getSize(trace)).to.equal(0);
    });

    it('should handle first expiring', () => {
      const cache = new PathCache(kingdom, 10, pathProvider);
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
      const cache = new PathCache(kingdom, 10, pathProvider);
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

      const cache = new PathCache(kingdom, 10, pathProvider);
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
});
