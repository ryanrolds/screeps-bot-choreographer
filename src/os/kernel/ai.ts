import {findRemotes} from '../../base/find_remotes';
import {ShardConfig} from '../../config';
import BasesDebugger from '../../debug/bases';
import CostMatrixDebugger from '../../debug/costmatrix';
import {HUDRunnable} from '../../debug/hud';
import MinCutDebugger from '../../debug/mincut';
import MusterDebugger from '../../debug/muster';
import PathDebugger from '../../debug/path';
import {CostMatrixCache} from '../../lib/costmatrix_cache';
import {EventBroker} from '../../lib/event_broker';
import {Metrics} from '../../lib/metrics';
import {getPath} from '../../lib/pathing';
import {PathCache} from '../../lib/path_cache';
import {Topics} from '../../lib/topics';
import {Tracer} from '../../lib/tracing';
import {BaseManager} from '../../managers/bases';
import BufferManager from '../../managers/buffer';
import {CreepManager} from '../../managers/creeps';
import InvaderManager from '../../managers/invaders';
import {ResourceManager} from '../../managers/resources';
import {Scribe} from '../../managers/scribe';
import KingdomGovernorRunnable from '../../managers/shards';
import {SiteJanitor} from '../../managers/site_janitor';
import WarManager from '../../managers/war';
import {Kernel} from '../../os/kernel/kernel';
import {MemoryManager} from '../memory';
import {Process} from '../process';
import {Priorities, Scheduler} from '../scheduler';

export class AI implements Kernel {
  private config: ShardConfig;
  private scheduler: Scheduler;
  private broker: EventBroker;
  private topics: Topics;
  private planning: BaseManager;
  private scribe: Scribe;
  private creeps: CreepManager;
  private pathCache: PathCache;
  private costMatrixCache: CostMatrixCache;
  private resourceManager: ResourceManager;
  private warManager: WarManager;

  constructor(config: ShardConfig, scheduler: Scheduler, trace: Tracer) {
    trace = trace.begin('ai_constructor');

    this.config = config;
    this.scheduler = scheduler;

    // ========= IPC ==========
    this.broker = new EventBroker();
    this.topics = new Topics();

    // ========= Caches =======
    this.pathCache = new PathCache(250, getPath);
    this.costMatrixCache = new CostMatrixCache();

    // ========= Core =========

    // Memory manager process, prepare memory cache and cleans old caches
    // Things that extend PersistentMemory must be after this
    const memoryManager = new MemoryManager();
    scheduler.registerProcess(new Process('memory_manager', 'memory_manager',
      Priorities.CRITICAL, memoryManager));

    // Journal game state, object permanence
    this.scribe = new Scribe(trace);
    trace.info('scribe created', {numRooms: this.scribe.getRooms().length});
    scheduler.registerProcess(new Process('scribe', 'scribe', Priorities.CRITICAL, this.scribe));

    // Base manager, decides when to expand
    this.planning = new BaseManager(config, this.scheduler, trace);
    scheduler.registerProcess(new Process('bases', 'planning',
      Priorities.CRITICAL, this.planning));

    // Creep manager
    this.creeps = new CreepManager(scheduler);
    scheduler.registerProcess(new Process(this.creeps.id, 'creeps_manager',
      Priorities.CRITICAL, this.creeps));

    // TODO rename this
    // Kingdom Governor (Inter-shard communication)
    scheduler.registerProcess(new Process('kingdom_governor', 'kingdom_governor',
      Priorities.CRITICAL, new KingdomGovernorRunnable()));

    // ========= High-level managers

    // Resource Manager
    this.resourceManager = new ResourceManager(this);
    scheduler.registerProcess(new Process('resource_manager', 'resource_manager',
      Priorities.LOGISTICS, this.resourceManager));

    // Site Janitor
    const siteJanitorId = 'site_janitor';
    const siteJanitor = new SiteJanitor();
    scheduler.registerProcess(new Process(siteJanitorId, 'site_janitor',
      Priorities.CRITICAL, siteJanitor));

    // Buffer manager
    const bufferManagerId = 'buffer_manager';
    const bufferManager = new BufferManager(bufferManagerId, trace);
    scheduler.registerProcess(new Process(bufferManagerId, 'buffer_manager',
      Priorities.DEFENCE, bufferManager));

    // Invader manager
    if (Game.shard?.name !== 'shard3') {
      const invaderManagerId = 'invader_manager';
      const invaderManager = new InvaderManager(invaderManagerId, scheduler);
      scheduler.registerProcess(new Process(invaderManagerId, 'invader_manager',
        Priorities.ATTACK, invaderManager));
    }

    // War manager
    const warManagerId = 'war_manager';
    const warManager = new WarManager(warManagerId, scheduler);
    scheduler.registerProcess(new Process(warManagerId, 'war_manager',
      Priorities.ATTACK, warManager));

    this.warManager = warManager;

    // ======= Debugging tools ========

    // Path debugger
    const hudRunnable = new HUDRunnable();
    scheduler.registerProcess(new Process('hud', 'hud', Priorities.DEBUG, hudRunnable));

    // Path debugger
    const pathDebuggerId = 'path_debugger';
    const pathDebugger = new PathDebugger(pathDebuggerId, this);
    scheduler.registerProcess(new Process(pathDebuggerId, 'path_debugger',
      Priorities.DEBUG, pathDebugger));

    // CostMatrix debugger
    const costMatrixDebuggerId = 'costmatrix_debugger';
    const costMatrixDebugger = new CostMatrixDebugger(costMatrixDebuggerId);
    scheduler.registerProcess(new Process(costMatrixDebuggerId, 'costmatrix_debugger',
      Priorities.DEBUG, costMatrixDebugger));

    // Expansion debugger
    const expandDebuggerId = 'expand_debugger';
    const expandDebugger = new BasesDebugger(expandDebuggerId, this);
    scheduler.registerProcess(new Process(expandDebuggerId, 'expand_debugger',
      Priorities.DEBUG, expandDebugger));

    // Min cut debugger
    const minCutDebuggerId = 'mincut_debugger';
    const minCutDebugger = new MinCutDebugger(minCutDebuggerId);
    scheduler.registerProcess(new Process(minCutDebuggerId, 'mincut_debugger',
      Priorities.DEBUG, minCutDebugger));

    // Muster debugger
    const musterDebuggerId = 'muster_debugger';
    const musterDebugger = new MusterDebugger(musterDebuggerId);
    scheduler.registerProcess(new Process(musterDebuggerId, 'muster_debugger',
      Priorities.DEBUG, musterDebugger));

    // ======= ========================

    trace.end();
  }

  tick(trace: Tracer) {
    // Remove old messages from broker
    if (Game.time % 25 === 0) {
      this.broker.removeConsumed();
    }

    // Run the scheduler
    this.scheduler.tick(this, trace);

    if (Game.time % 5 === 0) {
      const end = trace.startTimer('update_stats');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Memory as any).stats = {};
      end();
    }

    trace.end();
  }

  getConfig(): ShardConfig {
    return this.config;
  }

  getTopics(): Topics {
    return this.topics;
  }

  getBroker(): EventBroker {
    return this.broker;
  }

  getScheduler(): Scheduler {
    return this.scheduler;
  }

  getCreepsManager(): CreepManager {
    return this.creeps;
  }

  getPlanner(): BaseManager {
    return this.planning;
  }

  getScribe(): Scribe {
    return this.scribe;
  }

  getPathCache(): PathCache {
    return this.pathCache;
  }

  getCostMatrixCache(): CostMatrixCache {
    return this.costMatrixCache;
  }

  getResourceManager(): ResourceManager {
    return this.resourceManager;
  }

  getWarManager(): WarManager {
    return this.warManager;
  }

  getFriends(): string[] {
    return this.config.friends;
  }

  getNeutrals(): string[] {
    return this.config.neutral;
  }

  getDontAttack(): string[] {
    return this.getFriends().concat(this.getNeutrals());
  }

  getAvoid(): string[] {
    return this.config.avoid;
  }

  getKOS(): string[] {
    return this.config.kos;
  }

  getNewTracer(): Tracer {
    return new Tracer('tracer', new Map(), new Metrics());
  }

  debugRemotes(baseId: string) {
    const trace = new Tracer('remote_debugger', new Map([['pid', 'remote_debugger']]), new Metrics());
    const base = this.planning.getBase(baseId);
    const [rooms, debug] = findRemotes(this, base, trace);
    trace.notice('remote rooms', {rooms, debug});
  }

  getPathDebugger(): PathDebugger {
    return this.scheduler.getProcess('path_debugger').runnable as PathDebugger;
  }

  getCostMatrixDebugger(): CostMatrixDebugger {
    return this.scheduler.getProcess('costmatrix_debugger').runnable as CostMatrixDebugger;
  }

  getBasesDebugger(): BasesDebugger {
    return this.scheduler.getProcess('expand_debugger').runnable as BasesDebugger;
  }

  getMinCutDebugger(): MinCutDebugger {
    return this.scheduler.getProcess('mincut_debugger').runnable as MinCutDebugger;
  }

  getMusterDebugger(): MusterDebugger {
    return this.scheduler.getProcess('muster_debugger').runnable as MusterDebugger;
  }
}
