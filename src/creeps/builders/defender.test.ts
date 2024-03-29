import {expect} from 'chai';
import 'mocha';
import {Metrics} from '../../lib/metrics';
import {Tracer} from '../../lib/tracing';
import {newMultipliers} from './attacker';
import {buildDefender} from './defender';

describe('Defender Builder', function () {
  context('buildDefender', () => {
    const trace = new Tracer('test', new Map([['pid', 'test']]), new Metrics());

    it('fail to defend lvl1 room from basic invader', () => {
      const multipliers = newMultipliers();
      const tanking = 40; // 1 attack and 1 ranged attack
      const [result, ok] = buildDefender(tanking, 300, multipliers, trace);
      expect(ok).to.be.false;
      expect(result).to.deep.equal([HEAL, MOVE]);
    });

    it('fail to defend lvl2 room from basic invader', () => {
      const multipliers = newMultipliers();
      const tanking = 40; // 1 attack and 1 ranged attack
      const [result, ok] = buildDefender(tanking, 550, multipliers, trace);
      expect(ok).to.be.false;
      expect(result).to.deep.equal([HEAL, HEAL, MOVE]);
    });

    it('fail to defend lvl3 room from basic invader', () => {
      const multipliers = newMultipliers();
      const tanking = 40; // 1 attack and 1 ranged attack
      const [result, ok] = buildDefender(tanking, 800, multipliers, trace);
      expect(ok).to.be.false;
      expect(result).to.deep.equal([TOUGH, TOUGH, MOVE, HEAL, HEAL, MOVE]);
    });

    it('fail to defend lvl4 room from basic invader', () => {
      const multipliers = newMultipliers();
      const tanking = 40; // 1 attack and 1 ranged attack
      const [result, ok] = buildDefender(tanking, 1300, multipliers, trace);
      expect(ok).to.be.true;
      expect(result).to.deep.equal([RANGED_ATTACK, MOVE, HEAL, HEAL, MOVE, HEAL, HEAL, MOVE]);
    });

    it('fail to defend lvl5 room from basic invader', () => {
      const multipliers = newMultipliers();
      const tanking = 40; // 1 attack and 1 ranged attack
      const [result, ok] = buildDefender(tanking, 1800, multipliers, trace);
      expect(ok).to.be.true;
      expect(result).to.deep.equal([
        RANGED_ATTACK, RANGED_ATTACK, MOVE,
        RANGED_ATTACK, RANGED_ATTACK, MOVE,
        HEAL, HEAL, MOVE,
        HEAL, HEAL, MOVE]);
    });

    it('fail to defend lvl6 room from basic invader', () => {
      const multipliers = newMultipliers();
      const tanking = 40; // 1 attack and 1 ranged attack
      const [result, ok] = buildDefender(tanking, 2300, multipliers, trace);
      expect(ok).to.be.true;
      expect(result).to.deep.equal([
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, MOVE,
        RANGED_ATTACK, RANGED_ATTACK, MOVE,
        RANGED_ATTACK, RANGED_ATTACK, MOVE,
        RANGED_ATTACK, RANGED_ATTACK, MOVE,
        HEAL, HEAL, MOVE,
        HEAL, HEAL, MOVE]);
    });
  });
});
