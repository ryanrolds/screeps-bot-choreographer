import {Scheduler} from './os.scheduler';
import {Process, RunnableResult, running} from './os.process';
import {Tracer} from './lib.tracing';

import 'mocha';
import {expect} from 'chai';
import * as sinon from 'sinon';

describe('Scheduler', () => {
  let sandbox = null;
  let runnable = null;
  let runSpy = null;
  let process = null;
  let processSpy = null;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    global.Game = {
      time: 1,
      cpu: {
        limit: 20,
        tickLimit: 20,
        bucket: 10000,
        getUsed: (): number => {
          return 0;
        }
      }
    } as Game;
    // @ts-ignore : allow adding Memory to global
    global.Memory = {} as Memory;

    runnable = {
      run: (trace: Tracer): RunnableResult => {
        return running();
      }
    };

    runSpy = sandbox.spy(runnable, 'run');
    process = new Process('processId', 0, runnable);
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
    scheduler.registerProcess(process);
    scheduler.tick(new Tracer('test'));

    expect(runSpy.calledOnce).to.be.true;
  });

  it('should skip process if nearing tick limit', () => {
    // Set the used time to 99%, so that do not run any more processes
    Game.cpu.getUsed = (): number => {
      return Game.cpu.tickLimit * 0.99;
    };

    const scheduler = new Scheduler();
    scheduler.registerProcess(process);
    scheduler.tick(new Tracer('test'));

    expect(runSpy.calledOnce).to.be.false;
  })

  it('should execute skipped processes next tick', () => {
    const tracer = new Tracer('test');

    // Set the used time to 99%, so that do not run any more processes
    const stub = sandbox.stub(Game.cpu, 'getUsed')
    stub.onCall(0).returns(0);
    stub.onCall(1).returns(Game.cpu.tickLimit * 0.99);

    const scheduler = new Scheduler();
    scheduler.registerProcess(process);

    const processTwo = new Process('processTwo', 0, runnable)
    const processTwoSpy = sandbox.spy(processTwo, 'run');

    scheduler.registerProcess(processTwo);

    scheduler.tick(tracer);

    expect(processSpy.calledOnce).to.be.true;
    expect(processTwoSpy.calledOnce).to.be.false;
    expect(process.lastRun).to.equal(1);
    expect(processTwo.lastRun).to.equal(0);

    stub.resetHistory();
    processSpy.resetHistory();
    processTwoSpy.resetHistory();

    // Increment game time
    Game.time += 1;
    scheduler.tick(tracer);

    expect(processSpy.calledOnce).to.be.false;
    expect(processTwoSpy.calledOnce).to.be.true;

    expect(process.lastRun).to.equal(1);
    expect(processTwo.lastRun).to.equal(2);
  })

  it('should allow checking if process present', () => {
    const scheduler = new Scheduler();
    scheduler.registerProcess(process);

    expect(scheduler.hasProcess('processId')).to.be.true;
    expect(scheduler.hasProcess('shouldnotexist')).to.be.false;
  })
});
