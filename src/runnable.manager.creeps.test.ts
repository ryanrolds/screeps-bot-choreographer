import 'mocha';
import {expect} from 'chai';
import * as sinon from 'sinon';
import {stubObject, StubbedInstance} from "ts-sinon";
import {setup, mockGlobal, mockInstanceOf} from "screeps-test-helper";


import {Scheduler} from './os.scheduler';
import {Process, terminate} from './os.process';
import {CreepManager} from './runnable.manager.creeps';
import {Tracer} from './lib.tracing';
import * as MEMORY from './constants.memory';
import * as CREEPS from './constants.creeps';
import {Kingdom} from './org.kingdom';

describe('Creeps Manager', () => {
  let kingdom: Kingdom = null;
  let scheduler = null;
  let tracer: Tracer = null;

  beforeEach(() => {
    setup(global);

    const creepA = mockInstanceOf<Creep>({
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });
    const creepB = mockInstanceOf<Creep>({
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });
    const creepC = mockInstanceOf<Creep>({
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });

    mockGlobal<Game>('Game', {
      time: 1,
      shard: {
        name: 'shard0',
      },
      cpu: {
        limit: 20,
        tickLimit: 50,
        // Needed for tracer
        getUsed: () => {
          return 0;
        }
      },
      creeps: {
        creepA,
        creepB,
        creepC,
      }
    });

    scheduler = sinon.spy(new Scheduler() as any)
    tracer = new Tracer('test', 'creep_manager_test');
  });

  it("should create a process for each creep", () => {
    const creepManager = new CreepManager('creep_manager', scheduler);
    creepManager.run(kingdom, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(3);
  });

  it("should allow adding new creeps in later ticks", () => {
    const creepManager = new CreepManager('creep_manager', scheduler);
    creepManager.run(kingdom, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(3)

    Game.creeps['creepD'] = mockInstanceOf<Creep>({
      memory: {
        [MEMORY.MEMORY_ROLE]: CREEPS.WORKER_MINER,
      },
    });

    creepManager.run(kingdom, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(4);
  });

  it("should terminate process when creep is no longer around", () => {
    const creepManager = new CreepManager('creep_manager', scheduler);
    creepManager.run(kingdom, tracer);

    expect(scheduler.registerProcess.callCount).to.equal(3);

    Game.creeps['creepA'] = undefined;

    const process = scheduler.registerProcess.getCall(0).args[0];
    (process as unknown as Process).run(kingdom, tracer);
    expect(process.isTerminated()).to.be.true;
  });
})
