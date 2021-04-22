export { };

declare global {
  namespace NodeJS {
    interface Global {
      TRACING_ACTIVE: boolean;
      TRACING_FILTER: string;
      LOG_WHEN_ID: string;
      AI: any;
    }
  }
}
