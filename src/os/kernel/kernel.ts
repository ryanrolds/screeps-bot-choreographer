import {ShardConfig} from '../../config';
import {CostMatrixCache} from '../../lib/costmatrix_cache';
import {EventBroker} from '../../lib/event_broker';
import {PathCache} from '../../lib/path_cache';
import {Topics} from '../../lib/topics';
import {Tracer} from '../../lib/tracing';
import {BaseManager} from '../../managers/bases';
import {CreepManager} from '../../managers/creeps';
import {ResourceManager} from '../../managers/resources';
import {Scribe} from '../../managers/scribe';
import {Scheduler} from '../scheduler';

export interface Kernel {
  getConfig(): ShardConfig;
  getTopics(): Topics;
  getBroker(): EventBroker;
  getScheduler(): Scheduler;
  getCreepsManager(): CreepManager;
  getScribe(): Scribe;
  getPlanner(): BaseManager;
  getPathCache(): PathCache;
  getCostMatrixCache(): CostMatrixCache;
  getResourceManager(): ResourceManager;

  getFriends(): string[];
  getDontAttack(): string[];
  getAvoid(): string[];
  getKOS(): string[];
}

// Kernel thread
export interface KernelTheadActionFunc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (trace: Tracer, kernel: Kernel, ...args: any[]): void;
}

export interface KernelThreadFunc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (trace: Tracer, kernel: Kernel, ...args: any[]): void;
  reset(): void;
}

export const threadKernel = (name: string, ttl: number) => (action: KernelTheadActionFunc): KernelThreadFunc => {
  let lastCall = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tick = function (trace: Tracer, kernel: Kernel, ...args: any[]): void {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      const actionTrace = trace.begin(name);
      const result = action(actionTrace, kernel, ...args);
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

