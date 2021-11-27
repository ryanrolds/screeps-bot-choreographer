import {Tracer} from './lib.tracing';
import {Process} from './os.process';
import {Kingdom} from './org.kingdom';
import * as _ from 'lodash';

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

const SLOW_PROCESS_THRESHOLD = 5;
const LOW_BUCKET_MIN_PRIORITY = Priorities.RESOURCES;

export class Scheduler {
  processTable: Process[];
  processMap: Record<string, Process>;
  ranOutOfTime: number;
  timeLimit: number;
  created: number;
  terminated: number;

  constructor() {
    this.processTable = [];
    this.processMap = {};
    this.ranOutOfTime = 0;

    this.created = 0;
    this.terminated = 0;
    this.updateTimeLimit();
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

  private updateTimeLimit() {
    if (Game.shard.name === 'shard3') {
      this.timeLimit = 20;
      return;
    }

    this.timeLimit = Game.cpu.limit;
  }

  tick(kingdom: Kingdom, trace: Tracer) {
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
      trace = trace.withFields({pid: process.id});

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
        process.run(kingdom, trace);
        const processTime = Game.cpu.getUsed() - startProcessCpu;

        // We want to report slow processes
        if (processTime > SLOW_PROCESS_THRESHOLD) {
          trace.notice(`${process.type} took ${processTime}ms`, {pid: process.id, time: processTime})
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
    })

    const schedulerCpu = Game.cpu.getUsed() - startCpu;

    // TODO move stats to tracing/telemetry
    const stats = kingdom.getStats();
    stats.scheduler = {
      tickLimit: Game.cpu.tickLimit,
      cpuLimit: Game.cpu.limit,
      ranOutOfTime: this.ranOutOfTime,
      timeLimit: this.timeLimit,
      numProcesses: this.processTable.length,
      schedulerCpu: schedulerCpu,
      processCpu: processCpu,
      created: this.created,
      terminated: this.terminated
    };

    trace.end();
  };
}

