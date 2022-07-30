import {CreepManager} from './ai.creeps';
import {ShardConfig} from './config';
import {CostMatrixCache} from './lib.costmatrix_cache';
import {EventBroker} from './lib.event_broker';
import {PathCache} from './lib.path_cache';
import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {Scheduler} from './os.scheduler';
import {CentralPlanning} from './runnable.central_planning';
import {ResourceManager} from './runnable.manager.resources';
import {Scribe} from './runnable.scribe';

export interface Kernel {
  getConfig(): ShardConfig;
  getTopics(): Topics;
  getBroker(): EventBroker;
  getScheduler(): Scheduler;
  getCreepsManager(): CreepManager;
  getScribe(): Scribe;
  getPlanner(): CentralPlanning;
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
  (trace: Tracer, kernel: Kernel, ...args: any[]): void;
}

export interface KernelThreadFunc {
  (trace: Tracer, kernel: Kernel, ...args: any[]): void;
  reset(): void;
}

export const threadKernel = (name: string, ttl: number) => (action: KernelTheadActionFunc): KernelThreadFunc => {
  let lastCall = 0;

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

