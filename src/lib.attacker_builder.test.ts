import {expect} from 'chai';
import * as _ from 'lodash';
import 'mocha';
import {buildAttacker, newMultipliers} from './lib.attacker_builder';
import {Metrics} from './lib.metrics';
import {Tracer} from './lib.tracing';

// The number of tests in here is stupid. I mostly did it so that I could see the numbers
// and understand the maximum room it could attack and where the line was in the boosts

describe('Attacker Builder', function () {
  const towerDmg = 600;
  const quadSize = 4;
  const tower1 = Math.ceil(1 * towerDmg / quadSize);
  const tower2 = Math.ceil(2 * towerDmg / quadSize);
  const tower3 = Math.ceil(3 * towerDmg / quadSize);
  const tower6 = Math.ceil(6 * towerDmg / quadSize);

  context('buildattacker', () => {
    const trace = new Tracer('test', new Map([['pid', 'test']]), new Metrics());

    it('should build effective attacker for RCL 1 by a RCL 1', () => {
      const multipliers = newMultipliers();
      const [result, ok] = buildAttacker(0, 300, multipliers, trace);
      expect(ok).to.be.true;
      expect(result).to.deep.equal([TOUGH, TOUGH, MOVE, ATTACK, ATTACK, MOVE]);
    });

    // RCL 3 from a 6

    it('should build ineffective attacker for RCL 3 by a RCL 6', () => {
      const multipliers = newMultipliers();
      const [result, ok] = buildAttacker(tower1, 2300, multipliers, trace);
      expect(ok).to.be.false;
      expect(result).to.deep.equal([TOUGH, TOUGH, MOVE, HEAL, HEAL, MOVE, HEAL, HEAL, MOVE,
        HEAL, HEAL, MOVE, HEAL, HEAL, MOVE]);
    });

    it('should build effective attacker for RCL 3 by a RCL 6 w/ 2x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 2;
      const [result, ok] = buildAttacker(tower1, 2300, multipliers, trace);
      expect(ok).to.be.true;
      expect(result).to.deep.equal([TOUGH, MOVE, ATTACK, ATTACK, MOVE, ATTACK, HEAL, MOVE, HEAL, HEAL, MOVE,
        HEAL, HEAL, MOVE, HEAL, HEAL, MOVE]);
    });

    // RCL 5 from 6

    it('should build ineffective attacker for RCL 6 by a RCL 6 w/ 3x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 3;
      const [result, ok] = buildAttacker(tower2, 2300, multipliers, trace);
      expect(ok).to.be.false;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 5, [HEAL]: 8, [TOUGH]: 2});
    });

    it('should build effective attacker for RCL 6 by a RCL 6 w/ 4x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 4;
      const [result, ok] = buildAttacker(tower2, 2300, multipliers, trace);
      expect(ok).to.be.true;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 6, [HEAL]: 7, [ATTACK]: 3, [TOUGH]: 1});
    });

    // RCL 5 from 7

    it('should build ineffective attacker for RCL 5 by a RCL 7', () => {
      const multipliers = newMultipliers();
      const [result, ok] = buildAttacker(tower2, 5600, multipliers, trace);
      expect(ok).to.be.false;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 11, [HEAL]: 20, [TOUGH]: 2});
    });

    it('should build ineffective attacker for RCL 5 by a RCL 7 w/ 2x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 2;
      const [result, ok] = buildAttacker(tower2, 5600, multipliers, trace);
      expect(ok).to.be.true;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 16, [HEAL]: 13, [ATTACK]: 19});
    });

    // RCL 5 from 8

    it('should build ineffective attacker for RCL 5 by a RCL 8', () => {
      const multipliers = newMultipliers();
      const [result, ok] = buildAttacker(tower2, 12900, multipliers, trace);
      expect(ok).to.be.true;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 17, [HEAL]: 25, [ATTACK]: 8});
    });

    // RCL 7 from 6

    it('should build ineffective attacker for RCL 7 by a RCL 6 w/ 4x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 4;
      const [result, ok] = buildAttacker(tower3, 2300, multipliers, trace);
      expect(ok).to.be.false;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 5, [HEAL]: 8, [TOUGH]: 2});
    });

    // RCL 7 target from 7

    it('should build ineffective attacker for RCL 7 by a RCL 7', () => {
      const multipliers = newMultipliers();
      const [result, ok] = buildAttacker(tower3, 5600, multipliers, trace);
      expect(ok).to.be.false;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 11, [HEAL]: 20, [TOUGH]: 2});
    });

    it('should build effective attacker for RCL 7 by a RCL 7 w/ 2x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 2;
      const [result, ok] = buildAttacker(tower3, 5600, multipliers, trace);
      expect(ok).to.be.true;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 12, [HEAL]: 19, [ATTACK]: 3, [TOUGH]: 1});
    });

    // RCL 8 target from 7

    it('should build ineffective attacker for RCL 8 by a RCL 7 w/ 3x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 3;
      const [result, ok] = buildAttacker(tower6, 5600, multipliers, trace);
      expect(ok).to.be.false;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 11, [HEAL]: 20, [TOUGH]: 2});
    });

    it('should build effective attacker for RCL 8 by a RCL 7 w/ 4x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 4;
      const [result, ok] = buildAttacker(tower6, 5600, multipliers, trace);
      expect(ok).to.be.true;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 12, [HEAL]: 19, [ATTACK]: 3, [TOUGH]: 1});
    });

    // RCL 8 target from 8

    it('should build ineffective attacker for RCL 8 by a RCL 8 w/ 2x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 2;
      const [result, ok] = buildAttacker(tower6, 12900, multipliers, trace);
      expect(ok).to.be.false;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 17, [HEAL]: 33});
    });

    it('should build effective attacker for RCL 8 by a RCL 8 w/ 3x heal boost', () => {
      const multipliers = newMultipliers();
      multipliers[HEAL] = 3;
      const [result, ok] = buildAttacker(tower6, 12900, multipliers, trace);
      expect(ok).to.be.true;
      expect(_.countBy(result)).to.deep.equal({[MOVE]: 17, [HEAL]: 25, [ATTACK]: 8});
    });
  });
});
