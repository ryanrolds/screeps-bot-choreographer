import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {ProcessStatus} from './os.process';

export interface Runnable {
  run(kernel: Kernel, trace: Tracer): RunnableResult;
}

export interface RunnableResult {
  status: ProcessStatus;
  sleepFor?: number;
}
