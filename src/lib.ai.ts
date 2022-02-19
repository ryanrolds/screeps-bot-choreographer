import {Kingdom} from './org.kingdom';
import {ShardConfig} from './config'
import {Tracer} from './lib.tracing';
import {Scheduler, Priorities} from './os.scheduler';
import {Process} from './os.process';
import {CreepManager} from './runnable.manager.creeps';
import WarManager from './runnable.manager.war';
import KingdomModelRunnable from './runnable.kingdom_model';
import KingdomGovernorRunnable from './runnable.kingdom_governor'
import DefenseManager from './runnable.manager.defense';
import BufferManager from './runnable.manager.buffer';
import PathDebugger from './runnable.debug_path';
import CostMatrixDebugger from './runnable.debug_costmatrix';
import {CentralPlanning} from './runnable.central_planning';
import {EventBroker} from './lib.event_broker';
import PlannerDebugger from './runnable.debug_planner';
import {HUDRunnable} from './runnable.debug_hud';
import MinCutDebugger from './runnable.debug_mincut';
import InvaderManager from './runnable.manager.invaders';
import {Scribe} from './runnable.scribe';

export class AI {
  scheduler: Scheduler;
  config: ShardConfig;
  kingdom: Kingdom;
  planning: CentralPlanning;
  scribe: Scribe;
  broker: EventBroker;
  gameMapExport: string;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    trace = trace.begin('ai_constructor');

    this.config = config;
    this.scheduler = scheduler;

    // Central planning, tracks relationships, policies, and colonies
    this.planning = new CentralPlanning(config, this.scheduler, trace);
    this.scheduler.registerProcess(new Process('central_planning', 'planning',
      Priorities.CRITICAL, this.planning));
    this.scribe = new Scribe();
    this.broker = new EventBroker();

    // Kingdom Model & Messaging process
    // Pump messages through kingdom, colonies, room, ect...
    this.kingdom = new Kingdom(config, this.scheduler, this.scribe, this.broker, this.planning, trace);
    this.scheduler.registerProcess(new Process('kingdom_model', 'kingdom_model',
      Priorities.CRITICAL, new KingdomModelRunnable()));

    // Scribe process
    this.scheduler.registerProcess(new Process('scribe', 'scribe', Priorities.CRITICAL, this.scribe));

    // Kingdom Governor
    this.scheduler.registerProcess(new Process('kingdom_governor', 'kingdom_governor',
      Priorities.CRITICAL, new KingdomGovernorRunnable()));

    // Creep manager
    const creepManagerId = 'creeps_manager';
    const creepManager = new CreepManager(creepManagerId, this.scheduler)
    this.scheduler.registerProcess(new Process(creepManagerId, 'creeps_manager',
      Priorities.CRITICAL, creepManager));

    // Defense manager, must run before towers and defenders
    const defenseManagerId = 'defense_manager';
    const defenseManager = new DefenseManager(this.kingdom, defenseManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(defenseManagerId, 'defense_manager',
      Priorities.CRITICAL, defenseManager));

    // Buffer manager
    const bufferManagerId = 'buffer_manager';
    const bufferManager = new BufferManager(bufferManagerId, trace);
    this.scheduler.registerProcess(new Process(bufferManagerId, 'buffer_manager',
      Priorities.DEFENCE, bufferManager));

    // Invader manager
    if (Game.shard?.name === 'shard2') {
      const invaderManagerId = 'invader_manager';
      const invaderManager = new InvaderManager(invaderManagerId, this.scheduler, trace);
      this.scheduler.registerProcess(new Process(invaderManagerId, 'invader_manager',
        Priorities.ATTACK, invaderManager));
    }

    // War manager
    const warManagerId = 'war_manager';
    const warManager = new WarManager(this.kingdom, warManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(warManagerId, 'war_manager',
      Priorities.ATTACK, warManager));

    // ======= Debugging tools ========

    // Path debugger
    const hudRunnable = new HUDRunnable();
    this.scheduler.registerProcess(new Process('hud', 'hud', Priorities.DEBUG, hudRunnable));

    // Path debugger
    const pathDebuggerId = 'path_debugger';
    const pathDebugger = new PathDebugger(pathDebuggerId, this.kingdom);
    this.scheduler.registerProcess(new Process(pathDebuggerId, 'path_debugger',
      Priorities.DEBUG, pathDebugger));

    // CostMatrix debugger
    const costMatrixDebuggerId = 'costmatrix_debugger';
    const costMatrixDebugger = new CostMatrixDebugger(costMatrixDebuggerId, this.kingdom);
    this.scheduler.registerProcess(new Process(costMatrixDebuggerId, 'costmatrix_debugger',
      Priorities.DEBUG, costMatrixDebugger));

    // Expansion debugger
    const expandDebuggerId = 'expand_debugger';
    const expandDebugger = new PlannerDebugger(expandDebuggerId, this.kingdom);
    this.scheduler.registerProcess(new Process(expandDebuggerId, 'expand_debugger',
      Priorities.DEBUG, expandDebugger));

    // Min cut debugger
    const minCutDebuggerId = 'mincut_debugger';
    const minCutDebugger = new MinCutDebugger(minCutDebuggerId, this.kingdom);
    this.scheduler.registerProcess(new Process(minCutDebuggerId, 'mincut_debugger',
      Priorities.DEBUG, minCutDebugger));

    // ======= ========================

    trace.end();
  }

  tick(trace: Tracer) {
    // Remove old messages from broker
    if (Game.time % 25 === 0) {
      this.broker.removeConsumed();
    }

    // Run the scheduler
    this.scheduler.tick(this.kingdom, trace);

    if (Game.time % 5 === 0) {
      const end = trace.startTimer('update_stats');
      this.kingdom.updateStats(trace);

      // Set stats in memory for pulling and display in Grafana
      (Memory as any).stats = this.kingdom.getStats();
      end();
    }

    trace.end();
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }

  getKingdom(): Kingdom {
    return this.kingdom;
  }

  getPathDebugger(): PathDebugger {
    return this.scheduler.getProcess('path_debugger').runnable as PathDebugger;
  }

  getCostMatrixDebugger(): CostMatrixDebugger {
    return this.scheduler.getProcess('costmatrix_debugger').runnable as CostMatrixDebugger;
  }

  getPlanningDebugger(): PlannerDebugger {
    return this.scheduler.getProcess('expand_debugger').runnable as PlannerDebugger;
  }

  getMinCutDebugger(): MinCutDebugger {
    return this.scheduler.getProcess('mincut_debugger').runnable as MinCutDebugger;
  }

  getTracer(): Tracer {
    return new Tracer('tracer', {}, Game.time);
  }
}
