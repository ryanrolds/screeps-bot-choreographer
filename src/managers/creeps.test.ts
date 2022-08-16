import {expect} from 'chai';
import 'mocha';
import {mockGlobal, mockInstanceOf, setup} from 'screeps-test-helper';
import * as sinon from 'sinon';
import * as CREEPS from '../constants/creeps';
import * as MEMORY from '../constants/memory';
import {Metrics} from '../lib/metrics';
import {Tracer} from '../lib/tracing';
import {Kernel} from '../os/kernel/kernel';
import {Process} from '../os/process';
import {Scheduler} from '../os/scheduler';
import {CreepManager} from './creeps';

describe('Creeps Manager', () => {
  const kernel: Kernel = null;
  let scheduler = null;
  let tracer: Tracer = null;

  beforeEach(() => {
    setup(global);

    const creepA = mockInstanceOf<Creep>({
      id: 'creepA' as Id<Creep>,
      name: 'creepA',
      spawning: false,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: 'W1N1',
        [MEMORY.MEMORY_BASE]: 'W1N1',
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });
    const creepB = mockInstanceOf<Creep>({
      id: 'creepB' as Id<Creep>,
      name: 'creepB',
      spawning: false,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: 'W1N1',
        [MEMORY.MEMORY_BASE]: 'W1N1',
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });
    const creepC = mockInstanceOf<Creep>({
      id: 'creepC' as Id<Creep>,
      name: 'creepC',
      spawning: false,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: 'W1N1',
        [MEMORY.MEMORY_BASE]: 'W1N1',
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });

    mockGlobal<Memory>('Memory', {
      proc: {},
    });

    mockGlobal<Game>('Game', {
      time: 1,
      shard: {
        name: 'shard0',
      },
      cpu: {
        limit: 20,
        tickLimit: 50,
        bucket: 10000,
        // Needed for tracer
        getUsed: () => {
          return 0;
        },
      },
      creeps: {
        creepA,
        creepB,
        creepC,
      },
    });

    scheduler = sinon.spy(new Scheduler());
    tracer = new Tracer('creep_manager_test', new Map(), new Metrics());
  });

  it('should create a process for each creep', () => {
    const creepManager = new CreepManager(scheduler);
    creepManager.run(kernel, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(3);
  });

  it('should allow adding new creeps in later ticks', () => {
    const creepManager = new CreepManager(scheduler);
    creepManager.run(kernel, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(3);

    Game.creeps['creepD'] = mockInstanceOf<Creep>({
      id: 'creepD' as Id<Creep>,
      name: 'creepD',
      spawning: false,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: 'W1N1',
        [MEMORY.MEMORY_BASE]: 'W1N1',
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });

    creepManager.run(kernel, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(4);
  });

  it('should terminate process when creep is no longer around', () => {
    const creepManager = new CreepManager(scheduler);
    creepManager.run(kernel, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(3);

    Game.creeps['creepA'] = undefined;

    const process = scheduler.registerProcess.getCall(0).args[0];
    (process as Process).run(kernel, tracer);
    expect(process.isTerminated()).to.be.true;
  });
});
