import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import * as _ from 'lodash';

export interface Runnable {
  run(kingdom: Kingdom, trace: Tracer): RunnableResult;
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

export const sleeping = (sleepFor: number): RunnableResult => {
  return {status: STATUS_SLEEPING, sleepFor};
}

export const terminate = (): RunnableResult => {
  return {status: STATUS_TERMINATED};
}

export class Process {
  id: string;
  type: string;
  priority: number;
  runnable: Runnable;

  status: ProcessStatus;
  lastRun: number;
  nextRun: number;

  constructor(id: string, type: string, priority: number, runnable: Runnable) {
    this.id = id;
    this.type = type;
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
    this.status = STATUS_SLEEPING;
    this.nextRun = Game.time + duration;
  }

  setTerminated() {
    this.status = STATUS_TERMINATED;
  }

  run(kingdom: Kingdom, trace: Tracer) {
    this.lastRun = Game.time;
    const result = this.runnable.run(kingdom, trace);

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
