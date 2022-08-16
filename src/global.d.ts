import {AI} from "./os/kernel/ai";

export { };

declare global {
  namespace NodeJS {
    interface Global {
      Memory: Memory;
      METRIC_FILTER: string;
      METRIC_MIN: number;
      METRIC_REPORT: boolean;
      METRIC_CONSOLE: boolean;
      LOG_WHEN_PID: string;
      CPU_THROTTLE: number;
      SLOW_PROCESS: number;
      RESET_PIDS: boolean;
      AI: AI;
    }
  }
}
