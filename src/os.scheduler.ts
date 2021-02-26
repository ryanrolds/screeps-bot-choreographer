import {Tracer} from './lib.tracing';
import {Process} from './os.process';
import * as _ from 'lodash';

export class Scheduler {
  processTable: Process[];
  timeLimit: number;

  constructor() {
    this.processTable = [];
    this.timeLimit = Game.cpu.tickLimit * 0.95;
  }

  registerProcess(process) {
    this.processTable.push(process);
  };

  unregisterProcess(process) {
    this.processTable = _.pull(this.processTable, process);
  }

  isOutOfTime(): boolean {
    const timeUsed = Game.cpu.getUsed();
    if (timeUsed >= this.timeLimit) {
      return true;
    }

    return false;
  }

  hasProcess(id: string) {
    return _.filter(this.processTable, {id}).length > 0;
  }

  tick(trace: Tracer) {
    // Sort process table priority
    // -1 should maintain the same order
    this.processTable = _.sortByAll(this.processTable, ['priority', 'lastRun']);


    // Iterate processes and act on their status
    this.processTable.forEach((process) => {
      if (this.isOutOfTime()) {
        return;
      }

      if (process.isRunning()) {
        // Run the process
        process.run(trace);
      } else if (process.isSleeping()) {
        if (process.shouldWake()) {
          process.setRunning();
        }
      } else if (process.isTerminated()) {
        // TODO remove from scheduler
      } else {
        // console.log("bad status", result.status)
      }
    });
  };
}

