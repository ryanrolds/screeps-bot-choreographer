import {Tracer} from './lib.tracing';
import * as _ from 'lodash';
import {RUNNING} from './lib.behaviortree';

interface ActionFunc {
  (...args: any[]): any;
};

export const doEvery = (ttl: number, memory: Object, key: string) => (action: ActionFunc): any => {
  let lastCall = 0;

  if (memory && key) {
    lastCall = memory[key] || 0;
  }

  const tick = function (...args) {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      if (memory && key) {
        memory[key] = lastCall;
      }

      return action(...args);
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};

export class Scheduler {
  processTable: Process[];

  constructor() {
    this.processTable = [];
  }

  registerProcess(process) {
    this.processTable.push(process);
  };

  unregisterProcess(process) {
    this.processTable = _.pull(this.processTable, process);
  }

  tick(trace: Tracer) {
    // Sort process table priority
    // -1 should maintain the same order
    this.processTable = _.sortByAll(this.processTable, ['priority', 'lastRun']);
    const timeLimit = Game.cpu.tickLimit * 0.95;

    // Iterate processes and act on their status
    this.processTable.forEach((process) => {
      const timeUsed = Game.cpu.getUsed();
      if (timeUsed >= timeLimit) {
        return;
      }

      let status = process.status;
      switch (status) {
        case STATUS_RUNNING:
          // Run the process
          process.run(trace);
          break;
        case STATUS_SLEEPING:
          if (process.shouldWake()) {
            process.setRunning();
          }

          break;
        case STATUS_TERMINATED:
          // TODO remove from scheduler
          break;
        default:
        // console.log("bad status", result.status)
      }
    });
  };
}

export class Process {
  id: string;
  priority: number;
  runnable: Runnable;

  status: ProcessStatus;
  lastRun: number;
  nextRun: number;

  constructor(id: string, priority: number, runnable: Runnable) {
    this.id = id;
    this.priority = priority;
    this.runnable = runnable;

    this.status = STATUS_RUNNING;
    this.lastRun = 0;
    this.nextRun = 0;
  }

  shouldWake(): boolean {
    if (this.nextRun <= Game.time) {
      return true;
    }

    return false;
  }

  setRunning(): void {
    this.status = STATUS_RUNNING;
    this.nextRun = 0;
  }

  setSleeping(duration: number) {
    this.nextRun = Game.time + duration;
  }

  setTerminated() {
    this.status = STATUS_TERMINATED;
  }

  run(trace: Tracer) {
    this.lastRun = Game.time;
    const result = this.runnable.run(trace);

    switch (result.status) {
      case STATUS_RUNNING:
        break;
      case STATUS_SLEEPING:
        this.setSleeping(result.sleepFor);
        break;
      case STATUS_TERMINATED:
        this.setTerminated()
        break;
    }
  }
}

interface Runnable {
  run(trace: Tracer): RunnableResult;
}

export interface RunnableResult {
  status: ProcessStatus;
  sleepFor?: number;
}

type ProcessStatus = 'running' | 'sleeping' | 'stopped' | 'terminated';

const STATUS_RUNNING = 'running';
const STATUS_SLEEPING = 'sleeping';
const STATUS_TERMINATED = 'terminated';

export const running = (): RunnableResult => {
  return {status: STATUS_RUNNING};
}
