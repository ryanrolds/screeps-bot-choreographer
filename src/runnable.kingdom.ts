import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";

export default class KingdomRunnable {
  constructor() { }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    kingdom.update(trace);
    kingdom.process(trace);

    return running();
  }
}
