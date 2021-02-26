export { };

declare global {
  namespace NodeJS {
    interface Global {
      TRACING_ACTIVE: boolean;
      LOG_WHEN_ID: string;
      AI: any;
    }
  }
}
