import {expect} from 'chai';
import 'mocha';
import {mockGlobal} from 'screeps-test-helper';

import {Tracer} from './lib.tracing';
import {RoomEntry, Scribe} from './runnable.scribe';

describe('Scribe', function () {
  describe("memory management", function () {
    let trace = null;
    beforeEach(() => {
      mockGlobal<Memory>('Memory', {
        scribe: undefined,
      }, false);

      trace = new Tracer('scribe_test', new Map(), 0);
    });

    it("should setup empty memory", function () {
      const scribe = new Scribe(trace);
      scribe.writeMemory(new Tracer('test', new Map(), 0), null);

      const scribeMemory = (Memory as any).scribe;
      expect(scribeMemory.rooms).to.be.an('array');
      expect(scribeMemory.rooms).to.be.empty;
      expect(scribeMemory.creeps).to.be.an('array');
      expect(scribeMemory.rooms).to.be.empty;
    });

    it("should populate room from memory", function () {
      mockGlobal<Memory>('Memory', {
        scribe: {
          rooms: [['room1', {id: "bar"} as RoomEntry]],
          creeps: [],
        },
      }, true);

      const scribe = new Scribe(trace);
      expect(scribe.getRoomById("room1")?.id).to.equal("bar");
    });
  });
});
