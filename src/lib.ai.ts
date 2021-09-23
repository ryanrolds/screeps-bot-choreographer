import {Kingdom} from './org.kingdom';
import * as tracing from './lib.tracing';
import {KingdomConfig, ShardConfig} from './config'
import {Tracer} from './lib.tracing';
import {Scheduler, Priorities} from './os.scheduler';
import * as featureFlags from './lib.feature_flags'
import {Process} from './os.process';
import {CreepManager} from './runnable.manager.creeps';
import WarManager from './runnable.manager.war';
import {RoomManager} from './runnable.manager.rooms';
import KingdomModelRunnable from './runnable.kingdom_model';
import KingdomGovernorRunnable from './runnable.kingdom_governor'
import DefenseManager from './runnable.manager.defense';
import BufferManager from './runnable.manager.buffer';

export class AI {
  config: KingdomConfig;
  scheduler: Scheduler;
  kingdom: Kingdom;
  gameMapExport: string;

  constructor(config: KingdomConfig) {

    Game.map.visual.import(this.gameMapExport || "");

    const trace = new Tracer('ai', 'ai_constructor');

    this.config = config;
    this.scheduler = new Scheduler();
    this.kingdom = new Kingdom(config, this.scheduler, trace);

    // Kingdom Model & Messaging process
    // Pump messages through kingdom, colonies, room, ect...
    const kingdomModelId = 'kingdom_model';
    this.scheduler.registerProcess(new Process(kingdomModelId, 'kingdom_model',
      Priorities.CRITICAL, new KingdomModelRunnable(kingdomModelId)));

    // Kingdom Governor
    this.scheduler.registerProcess(new Process('kingdom_governor', 'kingdom_governor',
      Priorities.CRITICAL, new KingdomGovernorRunnable('kingdom_governor')));

    // Room Processes
    const roomManagerId = 'room_manager';
    const roomManager = new RoomManager(roomManagerId, this.scheduler);
    this.scheduler.registerProcess(new Process(roomManagerId, 'room_manager',
      Priorities.CRITICAL, roomManager));

    // Creep processes
    const creepManagerId = 'creeps_manager';
    const creepManager = new CreepManager(creepManagerId, this.scheduler)
    this.scheduler.registerProcess(new Process(creepManagerId, 'creeps_manager',
      Priorities.CRITICAL, creepManager));

    // Defense manager
    const defenseManagerId = 'defense_manager';
    const defenseManager = new DefenseManager(this.kingdom, defenseManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(defenseManagerId, 'defense_manager',
      Priorities.DEFENCE, defenseManager));

    // Buffer manager
    const bufferManagerId = 'buffer_manager';
    const bufferManager = new BufferManager(bufferManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(bufferManagerId, 'buffer_manager',
      Priorities.DEFENCE, bufferManager));

    // War manager
    const warManagerId = 'war_manager';
    const warManager = new WarManager(this.kingdom, warManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(warManagerId, 'war_manager',
      Priorities.ATTACK, warManager));

    this.gameMapExport = Game.map.visual.export();

    trace.end();
  }

  tick(trace: Tracer) {
    trace = trace.begin('tick');

    // Run the scheduler
    const schedulerTrace = trace.begin('scheduler');
    this.scheduler.tick(this.kingdom, schedulerTrace);
    schedulerTrace.end();

    if (Game.time % 5 === 0) {
      const statsTrace = trace.begin('stats');
      this.kingdom.updateStats();

      // Set stats in memory for pulling and display in Grafana
      (Memory as any).stats = this.kingdom.getStats();
      statsTrace.end();
    }

    trace.end();
  }

  getKingdom(): Kingdom {
    return this.kingdom;
  }
}
