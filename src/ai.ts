import {CreepManager} from './ai.creeps';
import {ShardConfig} from './config';
import {EventBroker} from './lib.event_broker';
import {findNextRemoteRoom} from './lib.remote_room';
import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import {MemoryManager} from './os.memory';
import {Process} from './os.process';
import {Priorities, Scheduler} from './os.scheduler';
import {CentralPlanning} from './runnable.central_planning';
import CostMatrixDebugger from './runnable.debug_costmatrix';
import {HUDRunnable} from './runnable.debug_hud';
import MinCutDebugger from './runnable.debug_mincut';
import PathDebugger from './runnable.debug_path';
import PlannerDebugger from './runnable.debug_planner';
import KingdomGovernorRunnable from './runnable.kingdom_governor';
import KingdomModelRunnable from './runnable.kingdom_model';
import BufferManager from './runnable.manager.buffer';
import DefenseManager from './runnable.manager.defense';
import InvaderManager from './runnable.manager.invaders';
import WarManager from './runnable.manager.war';
import {Scribe} from './runnable.scribe';
import {SiteJanitor} from './runnable.site_janitor';

export class AI {
  private config: ShardConfig;
  private scheduler: Scheduler;
  private broker: EventBroker;
  private topics: Topics;
  private kingdom: Kingdom;
  private planning: CentralPlanning;
  private scribe: Scribe;
  private creeps: CreepManager;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    trace = trace.begin('ai_constructor');

    this.config = config;
    this.scheduler = scheduler;

    // ========= IPC =========
    this.broker = new EventBroker();
    this.topics = new Topics();

    // ========= Core =========

    // Memory manager process, prepare memory cache and cleans old caches
    // Things that extend PersistentMemory must be after this
    const memoryManager = new MemoryManager()
    scheduler.registerProcess(new Process('memory_manager', 'memory_manager',
      Priorities.CRITICAL, memoryManager));

    // Journal game state
    this.scribe = new Scribe();
    trace.notice('scribe created', {numRooms: this.scribe.getRooms().length});
    scheduler.registerProcess(new Process('scribe', 'scribe', Priorities.CRITICAL, this.scribe));

    // Central planning, tracks relationships, policies, and colonies
    this.planning = new CentralPlanning(config, this.scheduler, trace);
    scheduler.registerProcess(new Process('central_planning', 'planning',
      Priorities.CRITICAL, this.planning));

    // Creep manager
    this.creeps = new CreepManager(scheduler)
    scheduler.registerProcess(new Process(this.creeps.id, 'creeps_manager',
      Priorities.CRITICAL, this.creeps));

    // TODO remove Kingdom and replace with passing AI around instead
    // Kingdom Model & Messaging process
    // Pump messages through kingdom, colonies, room, ect...
    this.kingdom = new Kingdom(config, scheduler, this.scribe, this.topics, this.broker,
      this.planning, this.creeps, trace);
    scheduler.registerProcess(new Process('kingdom_model', 'kingdom_model',
      Priorities.CRITICAL, new KingdomModelRunnable()));

    // TODO rename this
    // Kingdom Governor (Inter-shard communication)
    scheduler.registerProcess(new Process('kingdom_governor', 'kingdom_governor',
      Priorities.CRITICAL, new KingdomGovernorRunnable()));

    // ========= High-level managers

    // Site Janitor
    const siteJanitorId = 'site_janitor';
    const siteJanitor = new SiteJanitor();
    scheduler.registerProcess(new Process(siteJanitorId, 'site_janitor',
      Priorities.CRITICAL, siteJanitor));

    // Defense manager, must run before towers and defenders
    const defenseManagerId = 'defense_manager';
    const defenseManager = new DefenseManager(this.kingdom, defenseManagerId, scheduler, trace);
    scheduler.registerProcess(new Process(defenseManagerId, 'defense_manager',
      Priorities.CRITICAL, defenseManager));

    // Buffer manager
    const bufferManagerId = 'buffer_manager';
    const bufferManager = new BufferManager(bufferManagerId, trace);
    scheduler.registerProcess(new Process(bufferManagerId, 'buffer_manager',
      Priorities.DEFENCE, bufferManager));

    // Invader manager
    if (Game.shard?.name !== 'shard3') {
      const invaderManagerId = 'invader_manager';
      const invaderManager = new InvaderManager(invaderManagerId, scheduler, trace);
      scheduler.registerProcess(new Process(invaderManagerId, 'invader_manager',
        Priorities.ATTACK, invaderManager));
    }

    // War manager
    const warManagerId = 'war_manager';
    const warManager = new WarManager(this.kingdom, warManagerId, scheduler, trace);
    scheduler.registerProcess(new Process(warManagerId, 'war_manager',
      Priorities.ATTACK, warManager));

    // ======= Debugging tools ========

    // Path debugger
    const hudRunnable = new HUDRunnable();
    scheduler.registerProcess(new Process('hud', 'hud', Priorities.DEBUG, hudRunnable));

    // Path debugger
    const pathDebuggerId = 'path_debugger';
    const pathDebugger = new PathDebugger(pathDebuggerId, this.kingdom);
    scheduler.registerProcess(new Process(pathDebuggerId, 'path_debugger',
      Priorities.DEBUG, pathDebugger));

    // CostMatrix debugger
    const costMatrixDebuggerId = 'costmatrix_debugger';
    const costMatrixDebugger = new CostMatrixDebugger(costMatrixDebuggerId, this.kingdom);
    scheduler.registerProcess(new Process(costMatrixDebuggerId, 'costmatrix_debugger',
      Priorities.DEBUG, costMatrixDebugger));

    // Expansion debugger
    const expandDebuggerId = 'expand_debugger';
    const expandDebugger = new PlannerDebugger(expandDebuggerId, this.kingdom);
    scheduler.registerProcess(new Process(expandDebuggerId, 'expand_debugger',
      Priorities.DEBUG, expandDebugger));

    // Min cut debugger
    const minCutDebuggerId = 'mincut_debugger';
    const minCutDebugger = new MinCutDebugger(minCutDebuggerId, this.kingdom);
    scheduler.registerProcess(new Process(minCutDebuggerId, 'mincut_debugger',
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

  getCreepsManager(): CreepManager {
    return this.creeps;
  }

  getPlanning(): CentralPlanning {
    return this.planning;
  }

  debugGetNextRemote(baseId: string) {
    const trace = this.getTracer();
    const baseConfig = this.planning.getBaseConfig(baseId);
    const [room, debug] = findNextRemoteRoom(this.getKingdom(), baseConfig, trace);
    trace.notice('next remote room', {room, debug});
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
