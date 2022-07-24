import {Base} from "./base";
import {Kernel} from "./kernel";
import {Tracer} from "./lib.tracing";




// Base thread
export interface BaseRoomTheadActionFunc {
  (trace: Tracer, kernel: Kernel, base: Base, room: Room, ...args: any[]): void;
}

export interface BaseRoomThreadFunc {
  (trace: Tracer, kernel: Kernel, base: Base, ...args: any[]): void;
  reset(): void;
}

export const threadBaseRoom = (name: string, ttl: number) => (action: BaseRoomTheadActionFunc): BaseRoomThreadFunc => {
  let lastCall = 0;

  const tick = function (trace: Tracer, kernel: Kernel, base: Base, room: Room, ...args: any[]): void {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      const actionTrace = trace.begin(name);
      const result = action(actionTrace, kernel, base, room, ...args);
      actionTrace.end();

      return result;
    } else {
      trace.log(`thread ${name} sleeping for ${lastCall + ttl - Game.time}`);
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};
