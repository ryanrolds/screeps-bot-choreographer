import {Tracer} from './lib.tracing';

interface AnyTheadActionFunc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (trace: Tracer, ...args: any[]): void;
}

export interface AnyThreadFunc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (trace: Tracer, ...args: any[]): void;
  reset(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const threadAny = (name: string, ttl: number) => (action: AnyTheadActionFunc): AnyThreadFunc => {
  let lastCall = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tick = function (trace: Tracer, ...args: any[]): void {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      const actionTrace = trace.begin(name);
      const result = action(actionTrace, ...args);
      actionTrace.end();

      return result;
    } else {
      trace.info(`thread ${name} sleeping for ${lastCall + ttl - Game.time}`);
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};
