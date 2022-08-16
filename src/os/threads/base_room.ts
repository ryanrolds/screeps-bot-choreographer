import {Tracer} from "../../lib/tracing";
import {Base} from "../kernel/base";
import {Kernel} from "../kernel/kernel";

// Base thread
export interface BaseRoomTheadActionFunc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (trace: Tracer, kernel: Kernel, base: Base, room: Room, ...args: any[]): void;
}

export interface BaseRoomThreadFunc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (trace: Tracer, kernel: Kernel, base: Base, ...args: any[]): void;
  reset(): void;
}

export const threadBaseRoom = (name: string, ttl: number) => (action: BaseRoomTheadActionFunc): BaseRoomThreadFunc => {
  let lastCall = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tick = function (trace: Tracer, kernel: Kernel, base: Base, room: Room, ...args: any[]): void {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      const actionTrace = trace.begin(name);
      const result = action(actionTrace, kernel, base, room, ...args);
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
