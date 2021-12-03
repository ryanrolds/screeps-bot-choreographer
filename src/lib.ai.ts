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
import {CentralPlanning} from './runnable.central_planning';
import {ColonyManager} from './runnable.manager.colony';
import {EventBroker} from './lib.event_broker';


let lastMemoryTick: number = 0;
let lastMemory: Memory = null;

export class AI {
  scheduler: Scheduler;
  config: KingdomConfig;
  kingdom: Kingdom;
  planning: CentralPlanning;
  broker: EventBroker;
  gameMapExport: string;

  constructor(config: KingdomConfig, trace: Tracer) {
    trace = trace.begin('ai_constructor');

    this.config = config;
    this.scheduler = new Scheduler();

    // Central planning, tracks relationships, policies, and colonies
    this.planning = new CentralPlanning(config);
    this.scheduler.registerProcess(new Process('central_planning', 'planning',
      Priorities.CRITICAL, this.planning));
    this.broker = new EventBroker();

    // Remove old messages from broker
    if (Game.time % 25 === 0) {
      this.broker.removeConsumed();
    }

    // Kingdom Model & Messaging process
    // Pump messages through kingdom, colonies, room, ect...
    this.kingdom = new Kingdom(config, this.scheduler, this.broker, trace);
    const kingdomModelId = 'kingdom_model';
    this.scheduler.registerProcess(new Process(kingdomModelId, 'kingdom_model',
      Priorities.CRITICAL, new KingdomModelRunnable(kingdomModelId)));

    // Kingdom Governor
    this.scheduler.registerProcess(new Process('kingdom_governor', 'kingdom_governor',
      Priorities.CRITICAL, new KingdomGovernorRunnable('kingdom_governor')));

    // Colony manager
    const colonyManagerId = 'colony_manager';
    const colonyManager = new ColonyManager(colonyManagerId, this.planning, this.scheduler);
    this.scheduler.registerProcess(new Process(colonyManagerId, 'colony_manager',
      Priorities.CRITICAL, colonyManager));

    // Room manager
    const roomManagerId = 'room_manager';
    const roomManager = new RoomManager(roomManagerId, this.scheduler);
    this.scheduler.registerProcess(new Process(roomManagerId, 'room_manager',
      Priorities.CRITICAL, roomManager));

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
    const bufferManager = new BufferManager(bufferManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(bufferManagerId, 'buffer_manager',
      Priorities.DEFENCE, bufferManager));

    // Invader manager
    //const invaderManagerId = 'invader_manager';
    //const invaderManager = new InvaderManager(invaderManagerId, this.scheduler, trace);
    //this.scheduler.registerProcess(new Process(invaderManagerId, 'invader_manager',
    //  Priorities.ATTACK, invaderManager));

    // War manager
    const warManagerId = 'war_manager';
    const warManager = new WarManager(this.kingdom, warManagerId, this.scheduler, trace);
    this.scheduler.registerProcess(new Process(warManagerId, 'war_manager',
      Priorities.ATTACK, warManager));

    // ======= Debugging tools ========

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

    // ======= ========================

    trace.end();
  }

  tick(trace: Tracer) {
    const end = trace.startTimer('memory_hack');
    // memory hack from Dissi
    if (lastMemoryTick && lastMemory && Game.time === (lastMemoryTick + 1)) {
      delete global.Memory
      global.Memory = lastMemory;
      (RawMemory as any)._parsed = lastMemory
    } else {
      Memory;
      lastMemory = (RawMemory as any)._parsed
    }
    lastMemoryTick = Game.time
    end();

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
