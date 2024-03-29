import * as _ from 'lodash';
import {Tracer} from '../lib/tracing';
import {Kernel} from './kernel/kernel';
import {Process} from './process';

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
};

const LOW_BUCKET_MIN_PRIORITY = Priorities.RESOURCES;

export class Scheduler {
  private processTable: Process[];
  private processMap: Map<string, Process>;
  private ranOutOfTime: number;

  private timeLimit: number;
  private cpuThrottle: number;
  private slowProcessThreshold: number;

  constructor() {
    this.processTable = [];
    this.processMap = new Map();
    this.ranOutOfTime = 0;

    this.cpuThrottle = 0;
    this.slowProcessThreshold = 7.5;

    this.updateTimeLimit();
  }

  setCPUThrottle(throttle: number) {
    this.cpuThrottle = throttle;
  }

  setSlowProcessThreshold(threshold: number) {
    this.slowProcessThreshold = threshold;
  }

  registerProcess(process) {
    this.processTable.push(process);
    this.processMap.set(process.id, process);
  }

  unregisterProcess(process) {
    this.processTable = _.pull(this.processTable, process);
    this.processMap.delete(process.id);
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

  getOutOfTimeCount(): number {
    return this.ranOutOfTime;
  }

  hasProcess(id: string): boolean {
    return this.processMap.has(id);
  }

  getProcess(id: string): Process {
    return this.processMap.get(id);
  }

  getProcesses(): Process[] {
    return this.processTable;
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

    // Sort process table priority
    // -1 should maintain the same order
    this.processTable = _.sortByAll(this.processTable, ['adjustedPriority', 'skippable', 'lastRun']);

    const toRemove = [];
    const processCpu: Map<string, number> = new Map();

    if (Game.cpu.bucket < 1000) {
      trace.notice('low bucket, running only critical processes', {bucket: Game.cpu.bucket});
    }

    // Iterate processes and act on their status
    this.processTable.forEach((process) => {
      const processTrace = trace.as(process.type).withFields(new Map([['pid', process.id]]));

      // If bucket is low only run the most critical processes, should keep the bucket away from 0
      if (Game.cpu.bucket < 1000 && process.priority >= LOW_BUCKET_MIN_PRIORITY) {
        this.outOfTime(process);
        trace.getMetricsCollector().counter('scheduler_out_of_time_total', 1);
        return;
      }

      // If tick out of time, skip if process can be skipped
      if (this.isOutOfTime() && process.canSkip()) {
        this.outOfTime(process);
        trace.getMetricsCollector().counter('scheduler_out_of_time_total', 1);
        return;
      }

      if (process.isRunning()) {
        trace.getMetricsCollector().counter('scheduler_processes_running_total', 1, {process_type: process.type});

        const startProcessCpu = Game.cpu.getUsed();

        try {
          process.run(kernel, processTrace);
        } catch (e) {
          processTrace.error('process error', {id: process.id, error: e.stack});
          trace.getMetricsCollector().counter('scheduler_process_error_total', 1, {process_type: process.type});
        }

        const processTime = Game.cpu.getUsed() - startProcessCpu;
        trace.getMetricsCollector().counter('scheduler_cpu_time_total', processTime, {process_type: process.type});

        // We want to report slow processes
        if (processTime > this.slowProcessThreshold) {
          processTrace.warn(`slow process - ${processTrace.name}`, {id: process.id, type: process.type, time: processTime});
          trace.getMetricsCollector().counter('scheduler_slow_processes_total', 1, {process_type: process.type});
        }

        // Track time spent on each process by type
        if (!processCpu.has(process.type)) {
          processCpu.set(process.type, 0);
        }

        processCpu.set(process.type, processCpu.get(process.type) + processTime);
      } else if (process.isSleeping()) {
        if (process.shouldWake()) {
          process.setRunning();
        }

        trace.getMetricsCollector().counter('scheduler_processes_sleeping_total', 1, {process_type: process.type});
      } else if (process.isTerminated()) {
        toRemove.push(process);
        trace.getMetricsCollector().counter('scheduler_processes_terminated_total', 1, {process_type: process.type});
      }
    });

    toRemove.forEach((remove) => {
      this.unregisterProcess(remove);
    });

    trace.end();
  }
}

