
import * as _ from 'lodash';

import {Scheduler, Priorities} from "./os.scheduler";
import {Process, RunnableResult, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import ColonyRunnable from './runnable.colony';
import {CentralPlanning} from './runnable.central_planning';

const TTL = 25;

export class ColonyManager {
  id: string;
  scheduler: Scheduler;
  planning: CentralPlanning;

  constructor(id: string, planning: CentralPlanning, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.planning = planning;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.as('colony_manager_run');

    // If any defined colonies don't exist, run it
    const colonies = kingdom.getPlanner().getColonyConfigs();
    colonies.forEach((colony) => {
      const colonyProcessId = `colony_${colony.id}`;
      const hasProcess = this.scheduler.hasProcess(colonyProcessId);
      if (hasProcess) {
        return;
      }

      this.scheduler.registerProcess(new Process(colonyProcessId, 'colony', Priorities.CRITICAL,
        new ColonyRunnable(colony.id, this.scheduler)));
    });

    return sleeping(TTL);
  }
}
