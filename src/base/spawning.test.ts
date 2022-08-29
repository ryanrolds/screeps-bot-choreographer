import {expect} from 'chai';
import 'mocha';
import {DEFINITIONS, WORKER_MINER} from '../constants/creeps';
import {getBodyParts} from './spawning';

describe('Spawning', function () {
  describe('getBodyParts', function () {
    it('should build parts for 250 size miner', function () {
      const parts = getBodyParts(DEFINITIONS.get(WORKER_MINER), 250);
      expect(parts).to.eql([WORK, WORK, MOVE]);
    });
  });
});
