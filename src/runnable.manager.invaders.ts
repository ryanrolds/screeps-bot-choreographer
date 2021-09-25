import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {Scheduler} from "./os.scheduler";

const RUN_TTL = 25;

export default class InvaderManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id).begin('invader_manager_run');

    trace.end();

    return sleeping(RUN_TTL);
  }
}
