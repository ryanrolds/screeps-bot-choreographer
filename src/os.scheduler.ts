import * as _ from 'lodash';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {Process} from './os.process';

export const Priorities = {
  CRITICAL: 0,
  CORE_LOGISTICS: 1,
  DEFENCE: 2,
  RESOURCES: 3,
  OFFENSE: 4,
  ATTACK: 5,
  LOGISTICS: 6,
  MAINTENANCE: 7,
  EXPLORATION: 8,
  DEBUG: 9,
}

const LOW_BUCKET_MIN_PRIORITY = Priorities.RESOURCES;

export class Scheduler {
  processTable: Process[];
  processMap: Record<string, Process>;
  ranOutOfTime: number;

  timeLimit: number;
  cpuThrottle: number;
  slowProcessThreshold: number;

  created: number;
  terminated: number;

  constructor() {
    this.processTable = [];
    this.processMap = {};
    this.ranOutOfTime = 0;

    this.cpuThrottle = 0;
    this.slowProcessThreshold = 7.5;

    this.created = 0;
    this.terminated = 0;

    this.updateTimeLimit();
  }

  setCPUThrottle(throttle: number) {
    this.cpuThrottle = throttle;
  }

  setSlowProcessThreshold(threshold: number) {
    this.slowProcessThreshold = threshold;
  }

  registerProcess(process) {
    this.created++;
    this.processTable.push(process);
    this.updateProcessMap();
  };

  unregisterProcess(process) {
    this.terminated++;
    this.processTable = _.pull(this.processTable, process);
    this.updateProcessMap();
  }

  outOfTime(process: Process) {
    process.skip();
    this.ranOutOfTime++;
  }

  isOutOfTime(): boolean {
    const timeUsed = Game.cpu.getUsed();
    if (timeUsed >= this.timeLimit) {
      return true;
    }

    return false;
  }

  updateProcessMap() {
    this.processMap = _.indexBy(this.processTable, 'id');
  }

  hasProcess(id: string): boolean {
    return !!this.processMap[id]
  }

  getProcess(id: string): Process {
    return this.processMap[id];
  }

  listProcesses(filter: string) {

  }

  private updateTimeLimit() {
    const limit = Game.cpu.limit;
    const bucket = Game.cpu.bucket;
    this.timeLimit = limit * _.max([0.5, 1 - 10000 / bucket * 0.05]);

    if (this.cpuThrottle > 0 && this.timeLimit > this.cpuThrottle) {
      this.timeLimit = this.cpuThrottle;
    }
  }

  tick(kernel: Kernel, trace: Tracer) {
    trace = trace.begin('scheduler_tick');

    // Time limit change between ticks
    this.updateTimeLimit();

    const startCpu = Game.cpu.getUsed();

    // Sort process table priority
    // -1 should maintain the same order
    this.processTable = _.sortByAll(this.processTable, ['adjustedPriority', 'skippable', 'lastRun']);

    const toRemove = [];
    const processCpu: Record<string, number> = {};

    if (Game.cpu.bucket < 1000) {
      trace.notice('low bucket, running only critical processes', {bucket: Game.cpu.bucket})
    }

    // Iterate processes and act on their status
    this.processTable.forEach((process) => {
      const processTrace = trace.as(process.type).withFields({pid: process.id});

      // If bucket is low only run the most critical processes, should keep the bucket away from 0
      if (Game.cpu.bucket < 1000 && process.priority >= LOW_BUCKET_MIN_PRIORITY) {
        this.outOfTime(process);
        return;
      }

      // If tick out of time, skip if process can be skipped
      if (this.isOutOfTime() && process.canSkip()) {
        this.outOfTime(process);
        return;
      }

      if (process.isRunning()) {
        const startProcessCpu = Game.cpu.getUsed();

        try {
          process.run(kernel, processTrace);
        } catch (e) {
          processTrace.error('process error', {id: process.id, error: e.stack});
        }

        const processTime = Game.cpu.getUsed() - startProcessCpu;

        // We want to report slow processes
        if (processTime > this.slowProcessThreshold) {
          processTrace.warn(`slow process - ${processTrace.name}`, {id: process.id, type: process.type, time: processTime})
        }

        // Track time spent on each process by type
        if (!processCpu[process.type]) {
          processCpu[process.type] = 0;
        }
        processCpu[process.type] += processTime;
      } else if (process.isSleeping()) {
        if (process.shouldWake()) {
          process.setRunning();
        }
      } else if (process.isTerminated()) {
        toRemove.push(process);
      }
    });

    toRemove.forEach((remove) => {
      this.unregisterProcess(remove);
    });

    trace.end();
  };
}

