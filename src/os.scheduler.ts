import {Tracer} from './lib.tracing';
import {Process} from './os.process';
import {Kingdom} from './org.kingdom';
import * as _ from 'lodash';
import {start} from 'node:repl';

const TIME_LIMIT_FACTOR = 1.0;

export const Priorities = {
  CRITICAL: 0,
  DEFENCE: 1,
  RESOURCES: 2,
  OFFENSE: 3,
  LOGISTICS: 4,
  MAINTENANCE: 5,
  EXPLORATION: 6
}

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

  private updateTimeLimit() {
    if (Game.shard.name === 'shard3') {
      this.timeLimit = 20 * TIME_LIMIT_FACTOR;
      return;
    }

    this.timeLimit = Game.cpu.limit * TIME_LIMIT_FACTOR;
  }

  tick(kingdom: Kingdom, trace: Tracer) {
    // Time limit change between ticks
    this.updateTimeLimit();

    const startCpu = Game.cpu.getUsed();

    // Sort process table priority
    // -1 should maintain the same order
    this.processTable = _.sortByAll(this.processTable, ['priority', 'lastRun']);

    const toRemove = [];
    const processCpu: Record<string, number> = {};

    // Iterate processes and act on their status
    this.processTable.forEach((process) => {
      if (this.isOutOfTime()) {
        this.ranOutOfTime++;
        return;
      }

      const startProcessCpu = Game.cpu.getUsed();

      if (process.isRunning()) {
        // Run the process
        process.run(kingdom, trace);
      } else if (process.isSleeping()) {
        if (process.shouldWake()) {
          process.setRunning();
        }
      } else if (process.isTerminated()) {
        toRemove.push(process);
      } else {

      }

      if (!processCpu[process.type]) {
        processCpu[process.type] = 0;
      }

      processCpu[process.type] += Game.cpu.getUsed() - startProcessCpu;
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
  };
}

