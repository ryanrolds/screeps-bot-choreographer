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
      RESET_PIDS: boolean;
      AI: any;
    }
  }
}
