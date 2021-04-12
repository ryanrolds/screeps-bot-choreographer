import Kingdom from './org.kingdom';
import * as tracing from './lib.tracing';
import {KingdomConfig, ShardConfig} from './config'
import {Tracer} from './lib.tracing';
import {Scheduler, Priorities} from './os.scheduler';
import * as featureFlags from './lib.feature_flags'
import {Process} from './os.process';
import {CreepManager} from './manager.creeps';
import WarManager from './manager.war';
import {RoomManager} from './manager.rooms';
import KingdomModelRunnable from './runnable.kingdom_model';
import KingdomGovernorRunnable from './runnable.kingdom_governor'

export class AI {
  config: KingdomConfig;
  scheduler: Scheduler;
  kingdom: Kingdom;

  constructor(config: KingdomConfig) {
    const trace = tracing.startTrace('ai_constructor');

    this.config = config;
    this.scheduler = new Scheduler();
    this.kingdom = new Kingdom(config, this.scheduler, trace);

    // Kingdom Model & Messaging process
    // Pump messages through kingdom, colonies, room, ect...
    this.scheduler.registerProcess(new Process('kingdom_model', 'kingdom_model',
      Priorities.CRITICAL, new KingdomModelRunnable()));

    // Kingdom Governor
    this.scheduler.registerProcess(new Process('kingdom_governor', 'kingdom_governor',
      Priorities.CRITICAL, new KingdomGovernorRunnable('kingdom_governor')));

    // War manager
    const warManager = new WarManager(this.scheduler);
    this.scheduler.registerProcess(new Process('war_manager', 'war_manager',
      Priorities.OFFENSE, warManager));

    // Room Processes
    const roomManager = new RoomManager(this.scheduler);
    this.scheduler.registerProcess(new Process('room_manager', 'room_manager',
      Priorities.CRITICAL, roomManager));

    // Creep processes
    const useCreepManager = featureFlags.getFlag(featureFlags.CREEPS_USE_MANAGER);
    if (useCreepManager) {
      // Setup creep manager
      const creepManager = new CreepManager(this.scheduler)
      this.scheduler.registerProcess(new Process('creeps_manager', 'creeps_manager',
        Priorities.CRITICAL, creepManager));
    }

    trace.end();
  }

  tick(trace: Tracer) {
    trace = trace.begin('tick');

    // Run the scheduler
    const schedulerTrace = trace.begin('scheduler');
    this.scheduler.tick(this.kingdom, schedulerTrace);
    schedulerTrace.end();

    this.kingdom.updateStats();

    // Set stats in memory for pulling and display in Grafana
    (Memory as any).stats = this.kingdom.getStats();

    trace.end();
  }
  getKingdom(): Kingdom {
    return this.kingdom;
  }
}
