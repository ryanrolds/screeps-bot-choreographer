export { };

declare global {
  namespace NodeJS {
    interface Global {
      Memory: Memory;
      TRACING_ACTIVE: boolean;
      TRACING_FILTER: string;
      METRIC_FILTER: string;
      METRIC_MIN: number;
      LOG_WHEN_ID: string;
      RESET_PIDS: boolean;
      AI: any;
    }
  }
}
