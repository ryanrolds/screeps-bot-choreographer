import {Kingdom} from './org.kingdom';
import {KingdomConfig, ShardConfig} from './config'
import {Tracer} from './lib.tracing';
import {Scheduler, Priorities} from './os.scheduler';
import {Process} from './os.process';
import {CreepManager} from './runnable.manager.creeps';
import WarManager from './runnable.manager.war';
import {RoomManager} from './runnable.manager.rooms';
import KingdomModelRunnable from './runnable.kingdom_model';
import KingdomGovernorRunnable from './runnable.kingdom_governor'
import DefenseManager from './runnable.manager.defense';
import BufferManager from './runnable.manager.buffer';
import PathDebugger from './runnable.path_debugger';
import CostMatrixDebugger from './runnable.costmatrix_debug';
import InvaderManager from './runnable.manager.invaders';
import ExpansionManager from './runnable.manager.expansion';


let lastMemoryTick: number = 0;
let lastMemory: Memory = null;

export class AI {
  config: KingdomConfig;
  scheduler: Scheduler;
  kingdom: Kingdom;
  gameMapExport: string;

  constructor(config: KingdomConfig) {
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

    // Defense manager, must run before towers and defenders
    const defenseManagerId = 'defense_manager';
    const defenseManager = new DefenseManager(this.kingdom, defenseManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(defenseManagerId, 'defense_manager',
      Priorities.CRITICAL, defenseManager));

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

    // Invader manager
    const invaderManagerId = 'invader_manager';
    const invaderManager = new InvaderManager(invaderManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(invaderManagerId, 'invader_manager',
      Priorities.ATTACK, invaderManager));

    // Expansion manager
    const expansionManagerId = 'expansion_manager';
    const expansionManager = new ExpansionManager(expansionManagerId, trace);
    this.scheduler.registerProcess(new Process(expansionManagerId, 'expansion_manager',
      Priorities.EXPLORATION, expansionManager));

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

    trace.end();
  }

  tick(trace: Tracer) {
    trace = trace.begin('tick');

    const memoryHack = trace.begin('memory_hack');
    // memory hack from Dissi
    if (lastMemoryTick && lastMemory && Game.time == (lastMemoryTick + 1)) {
      delete global.Memory
      global.Memory = lastMemory;
      (RawMemory as any)._parsed = lastMemory
    } else {
      Memory;
      lastMemory = (RawMemory as any)._parsed
    }
    lastMemoryTick = Game.time
    memoryHack.end();

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

  getPathDebugger(): PathDebugger {
    return this.scheduler.getProcess('path_debugger').runnable as PathDebugger;
  }

  getCostMatrixDebugger(): CostMatrixDebugger {
    return this.scheduler.getProcess('costmatrix_debugger').runnable as CostMatrixDebugger;
  }
}
