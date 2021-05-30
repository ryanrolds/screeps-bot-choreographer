import {Scheduler} from './os.scheduler';
import {Process, RunnableResult, running} from './os.process';
import {Tracer} from './lib.tracing';
import {mockGlobal} from "screeps-test-helper";

import 'mocha';
import {expect} from 'chai';
import * as sinon from 'sinon';
import {Kingdom} from './org.kingdom';
import {KingdomConfig} from './config';

describe('Scheduler', () => {
  let trace = null;
  let kingdom = null;
  let sandbox = null;
  let runnable = null;
  let runSpy = null;
  let process = null;
  let processSpy = null;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockGlobal<Game>('Game', {
      time: 1,
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
      }
    })

    trace = new Tracer('test', 'scheduler_test');

    runnable = {
      run: (trace: Tracer): RunnableResult => {
        return running();
      }
    };

    runSpy = sandbox.spy(runnable, 'run');
    process = new Process('processId', 'processType', 0, runnable);
    processSpy = sandbox.spy(process, 'run');
  });

  afterEach(() => {
    sandbox.reset();
  })

  it('should create empty scheduler', () => {
    const scheduler = new Scheduler();
    expect(scheduler.processTable).to.be.an('array');
    expect(scheduler.processTable).to.be.empty;
  })

  it('should be able to register a process', () => {
    const scheduler = new Scheduler();
    scheduler.registerProcess(process);
    expect(scheduler.processTable).to.have.lengthOf(1)
  })

  it('should run the process', () => {
    const scheduler = new Scheduler();
    const kingdom = new Kingdom({} as KingdomConfig, scheduler, trace);

    scheduler.registerProcess(process);
    scheduler.tick(kingdom, trace);

    expect(runSpy.calledOnce).to.be.true;
  });

  it('should skip process if nearing tick limit', () => {
    // Set the used time to 110%, so that do not run any more processes
    Game.cpu.getUsed = (): number => {
      return Game.cpu.limit * 1.1;
    };

    const scheduler = new Scheduler();
    const kingdom = new Kingdom({} as KingdomConfig, scheduler, trace);

    scheduler.registerProcess(process);
    scheduler.tick(kingdom, trace);

    expect(runSpy.calledOnce).to.be.false;
    expect(scheduler.ranOutOfTime).to.equal(1);
  })

  it('should execute skipped processes next tick', () => {
    const tracer = new Tracer('test', 'scheduler');

    const scheduler = new Scheduler();
    const kingdom = new Kingdom({} as KingdomConfig, scheduler, trace);

    scheduler.registerProcess(process);

    const stub = sandbox.stub(scheduler, 'isOutOfTime')
    stub.onCall(0).returns(false);
    stub.onCall(1).returns(true);

    const processTwo = new Process('processTwo', 'processType', 0, runnable)
    const processTwoSpy = sandbox.spy(processTwo, 'run');

    scheduler.registerProcess(processTwo);

    scheduler.tick(kingdom, trace);

    expect(processSpy.calledOnce).to.be.true;
    expect(processTwoSpy.calledOnce).to.be.false;
    expect(process.lastRun).to.equal(1);
    expect(processTwo.lastRun).to.equal(0);

    stub.resetHistory();
    processSpy.resetHistory();
    processTwoSpy.resetHistory();

    // Increment game time
    Game.time += 1;
    scheduler.tick(kingdom, trace);

    expect(processSpy.calledOnce).to.be.false;
    expect(processTwoSpy.calledOnce).to.be.true;

    expect(process.lastRun).to.equal(1);
    expect(processTwo.lastRun).to.equal(2);
  });

  it('should allow checking if process present', () => {
    const scheduler = new Scheduler();
    scheduler.registerProcess(process);

    expect(scheduler.hasProcess('processId')).to.be.true;
    expect(scheduler.hasProcess('shouldnotexist')).to.be.false;
  });

  it("should remove and not run terminated processes", () => {
    const scheduler = new Scheduler();
    const kingdom = new Kingdom({} as KingdomConfig, scheduler, trace);

    scheduler.registerProcess(process);

    expect(scheduler.hasProcess('processId')).to.be.true;
    expect(processSpy.calledOnce).to.be.false;

    scheduler.tick(kingdom, trace);
    expect(processSpy.calledOnce).to.be.true;
    expect(processSpy.calledTwice).to.be.false;

    process.setTerminated();
    expect(scheduler.processTable.length).to.equal(1);

    scheduler.tick(kingdom, trace);
    expect(processSpy.calledOnce).to.be.true;
    expect(processSpy.calledTwice).to.be.false;
    expect(scheduler.processTable.length).to.equal(0);
  });
});
