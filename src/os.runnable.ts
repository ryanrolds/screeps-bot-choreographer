import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {ProcessStatus} from "./os.process";

export interface Runnable {
  run(kingdom: Kingdom, trace: Tracer): RunnableResult;
}

export interface RunnableResult {
  status: ProcessStatus;
  sleepFor?: number;
}
