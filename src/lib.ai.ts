import Kingdom from './org.kingdom';
import * as tracing from './lib.tracing';
import {KingdomConfig} from './config'
import {Tracer} from './lib.tracing';
import {Scheduler} from './os.scheduler';
import * as featureFlags from './lib.feature_flags'
import {Process} from './os.process';
import {CreepManager} from './manager.creeps';

export class AI {
  config: KingdomConfig;
  kingdom: Kingdom;
  scheduler: Scheduler;

  constructor(config: KingdomConfig) {
    const trace = tracing.startTrace('ai_constructor');

    this.config = config;
    this.kingdom = new Kingdom(config, trace);
    this.scheduler = new Scheduler();

    const useCreepManager = featureFlags.getFlag(featureFlags.CREEPS_USE_MANAGER);
    if (useCreepManager) {
      // Setup creep manager
      const creepManager = new CreepManager(this.scheduler)
      this.scheduler.registerProcess(new Process('creeps_manager', 0, creepManager));
    }

    trace.end();
  }

  tick(trace: Tracer) {
    trace = trace.begin('tick');

    this.kingdom.update(trace);
    this.kingdom.process(trace);

    const useCreepManager = featureFlags.getFlag(featureFlags.CREEPS_USE_MANAGER);
    if (useCreepManager) {
      // Run the scheduler
      const schedulerTrace = trace.begin('scheduler');
      this.scheduler.tick(this.kingdom, schedulerTrace);
      schedulerTrace.end();
    }

    this.kingdom.updateStats();

    // Set stats in memory for pulling and display in Grafana
    (Memory as any).stats = this.kingdom.getStats();

    trace.end();
  }
  getKingdom(): Kingdom {
    return this.kingdom;
  }
}
