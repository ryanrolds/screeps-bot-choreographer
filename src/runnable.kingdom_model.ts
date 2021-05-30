import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";

export default class KingdomModelRunnable {
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    kingdom.update(trace);
    kingdom.process(trace);

    return running();
  }
}
