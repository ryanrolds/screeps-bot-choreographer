import {Tracer} from './lib.tracing';
import * as _ from 'lodash';

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

  isRunning(): boolean {
    return this.status === STATUS_RUNNING;
  }

  isSleeping(): boolean {
    return this.status === STATUS_SLEEPING;
  }

  isTerminated(): boolean {
    return this.status === STATUS_TERMINATED;
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
        this.setRunning();
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
