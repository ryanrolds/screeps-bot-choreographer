import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";

export default class KingdomModelRunnable {
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('kingdom_run');

    kingdom.update(trace);
    kingdom.process(trace);

    trace.end();

    return running();
  }
}
