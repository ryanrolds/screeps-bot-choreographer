
import * as _ from 'lodash';

import {Scheduler, Priorities} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from './org.kingdom';
import RoomRunnable from './runnable.room';

export class RoomManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    Object.entries(Game.rooms).forEach(([name, room]) => {
      const hasProcess = this.scheduler.hasProcess(name);
      if (hasProcess) {
        return;
      }

      this.scheduler.registerProcess(new Process(name, 'room', Priorities.RESOURCES,
        new RoomRunnable(name, this.scheduler)));
    });

    return running();
  }
}
