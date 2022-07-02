import {Tracer} from './lib.tracing';
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";

export default class KingdomModelRunnable {
  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('kingdom_run');

    kingdom.update(trace);
    kingdom.process(trace);

    trace.end();

    return running();
  }
}
