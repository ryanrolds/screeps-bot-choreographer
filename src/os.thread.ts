import {Tracer} from "./lib.tracing";

interface ActionFunc {
  (trace: Tracer, ...args: any[]): void;
};

export interface ThreadFunc {
  (trace: Tracer, ...args: any[]): void;
  reset(): void;
}

export const thread = (name: string, ttl: number) => (action: ActionFunc): ThreadFunc => {
  let lastCall = 0;

  const tick = function (trace: Tracer, ...args) {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      const actionTrace = trace.begin(name);
      const result = action(actionTrace, ...args);
      actionTrace.end();

      return result;
    } else {
      trace.log(`thread ${name} sleeping for ${lastCall + ttl - Game.time}`)
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};
