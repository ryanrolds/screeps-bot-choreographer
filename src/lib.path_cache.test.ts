import 'mocha';
import {expect} from 'chai';
import * as _ from "lodash";
import Sinon, * as sinon from 'sinon';
import {stubObject, StubbedInstance} from "ts-sinon";
import {setup, mockGlobal, mockInstanceOf} from "screeps-test-helper";
import {PathCacheItem} from "./lib.path_cache";

describe('Path Cache', function () {
  beforeEach(() => {
    mockGlobal<Game>('Game', {});
  });

  describe('PathCacheItem', () => {
    describe('constructor', () => {
      it('should create a PathCacheItem', () => {
        const path = {
          path: [],
          ops: 0,
          cost: 0,
          incomplete: false,
        };

        const item = new PathCacheItem("origin", "goal", path, 0);
        expect(item.next).to.equal(null);
        expect(item.prev).to.equal(null);
      });
    });

    describe('add', () => {

    });
  });
});
