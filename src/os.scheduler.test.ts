import {expect} from 'chai';
import 'mocha';
import {mockGlobal} from 'screeps-test-helper';
import * as sinon from 'sinon';
import {EventBroker} from './lib.event_broker';
import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {Process, running} from './os.process';
import {RunnableResult} from './os.runnable';
import {Scheduler} from './os.scheduler';


describe('Scheduler', () => {
  let trace = null;
  let broker = null;
  let topics = null;
  let sandbox = null;
  let runnable = null;
  let runSpy = null;
  let process = null;
  let processSpy = null;
  let kernel = null;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockGlobal<Game>('Game', {
      time: 1,
      shard: {
        name: 'shard0',
      },
      spawns: {},
      cpu: {
        limit: 20,
        tickLimit: 50,
        bucket: 10000,
        getUsed: () => {
          return 0;
        },
      },
      rooms: {},
      creeps: {},
    });

    mockGlobal<Memory>('Memory', {
      scribe: undefined,
      shard: {},
    }, true);

    trace = new Tracer('scheduler_test', new Map(), 0);

    broker = new EventBroker();
    topics = new Topics();

    runnable = {
      run: (trace: Tracer): RunnableResult => {
        return running();
      },
    };

    runSpy = sandbox.spy(runnable, 'run');
    process = new Process('processId', 'processType', 0, runnable);
    processSpy = sandbox.spy(process, 'run');
  });

  afterEach(() => {
    sandbox.reset();
  });

  it('should create empty scheduler', () => {
    const scheduler = new Scheduler();
    expect(scheduler.getProcesses()).to.be.an('array');
    expect(scheduler.getProcesses()).to.be.empty;
  });

  it('should be able to register a process', () => {
    const scheduler = new Scheduler();
    scheduler.registerProcess(process);
    expect(scheduler.getProcesses()).to.have.lengthOf(1);
  });

  it('should run the process', () => {
    const scheduler = new Scheduler();

    scheduler.registerProcess(process);
    scheduler.tick(null, trace);

    expect(runSpy.calledOnce).to.be.true;
  });

  it('should skip process if nearing tick limit', () => {
    // Set the used time to 110%, so that do not run any more processes
    Game.cpu.getUsed = (): number => {
      return Game.cpu.limit * 1.1;
    };

    const scheduler = new Scheduler();
    scheduler.registerProcess(process);
    scheduler.tick(kernel, trace);

    expect(runSpy.calledOnce).to.be.false;
    expect(scheduler.getOutOfTimeCount()).to.equal(1);
  });

  it('should execute skipped processes next tick', () => {
    const scheduler = new Scheduler();
    scheduler.registerProcess(process);

    const stub = sandbox.stub(scheduler, 'isOutOfTime');
    stub.onCall(0).returns(false);
    stub.onCall(1).returns(true);

    const processTwo = new Process('processTwo', 'processType', 0, runnable);
    const processTwoSpy = sandbox.spy(processTwo, 'run');

    scheduler.registerProcess(processTwo);

    scheduler.tick(kernel, trace);

    expect(processSpy.calledOnce).to.be.true;
    expect(processTwoSpy.calledOnce).to.be.false;
    expect(process.lastRun).to.equal(1);
    expect(processTwo.lastRun).to.equal(0);

    stub.resetHistory();
    processSpy.resetHistory();
    processTwoSpy.resetHistory();

    // Increment game time
    Game.time += 1;
    scheduler.tick(kernel, trace);

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

  it('should remove and not run terminated processes', () => {
    const scheduler = new Scheduler();
    scheduler.registerProcess(process);

    expect(scheduler.hasProcess('processId')).to.be.true;
    expect(processSpy.calledOnce).to.be.false;

    scheduler.tick(kernel, trace);
    expect(processSpy.calledOnce).to.be.true;
    expect(processSpy.calledTwice).to.be.false;

    process.setTerminated();
    expect(scheduler.getProcesses().length).to.equal(1);

    scheduler.tick(kernel, trace);
    expect(processSpy.calledOnce).to.be.true;
    expect(processSpy.calledTwice).to.be.false;
    expect(scheduler.getProcesses().length).to.equal(0);
  });
});
