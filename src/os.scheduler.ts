import {Tracer} from './lib.tracing';
import {Process} from './os.process';
import Kingdom from './org.kingdom';
import * as _ from 'lodash';

const TIME_LIMIT_FACTOR = 1.0;

/*
Priority descriptions

0 - Mission-critical logic
1 - Defenses
2 - Mining/harvesting, attacking
3 - Logistics
4 - Repair, building, reserving
5 - Exploring

*/

export class Scheduler {
  processTable: Process[];
  processMap: Record<string, Process>;
  ranOutOfTime: number;
  timeLimit: number;

  constructor() {
    this.processTable = [];
    this.processMap = {};
    this.ranOutOfTime = 0;
    this.updateTimeLimit();
  }

  registerProcess(process) {
    this.processTable.push(process);
    this.updateProcessMap();
  };

  unregisterProcess(process) {
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
    this.timeLimit = Game.cpu.limit * TIME_LIMIT_FACTOR;
  }

  tick(kingdom: Kingdom, trace: Tracer) {
    // Time limit change between ticks
    this.updateTimeLimit();

    // Sort process table priority
    // -1 should maintain the same order
    this.processTable = _.sortByAll(this.processTable, ['priority', 'lastRun']);

    const toRemove = [];

    // Iterate processes and act on their status
    this.processTable.forEach((process) => {
      if (this.isOutOfTime()) {
        this.ranOutOfTime++;
        return;
      }

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
        // console.log("bad status", result.status)
      }
    });

    // Remove/filter terminated processes
    this.processTable = this.processTable.filter((process) => {
      return toRemove.indexOf(process) === -1;
    });

    // TODO move stats to tracing/telemetry
    const stats = kingdom.getStats();
    stats.scheduler = {
      tickLimit: Game.cpu.tickLimit,
      cpuLimit: Game.cpu.limit,
      ranOutOfTime: this.ranOutOfTime,
      timeLimit: this.timeLimit,
      numProcesses: this.processTable.length
    };
  };
}

