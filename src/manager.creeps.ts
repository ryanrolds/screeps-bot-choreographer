import {Scheduler} from "./os.scheduler";
import {RunnableResult, running} from "./os.process";
import {Tracer} from './lib.tracing';
import * as _ from 'lodash';

export class CreepManager {
  scheduler: Scheduler;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  run(trace: Tracer): RunnableResult {
    console.log('creep manager')

    return running();
  }
}
