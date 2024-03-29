import * as CREEPS from '../constants/creeps';
import {DEFINITIONS} from '../constants/creeps';
import {MEMORY_BASE, MEMORY_ROLE, MEMORY_START_TICK} from '../constants/memory';
import {roleAttacker} from '../creeps/roles/attacker';
import {roleBuilder} from '../creeps/roles/builder';
import {roleDefender} from '../creeps/roles/defender';
import {roleDefenderDrone} from '../creeps/roles/defender_drone';
import {roleDistributor} from '../creeps/roles/distributor';
import {roleExplorer} from '../creeps/roles/explorer';
import {roleHarasser, ROLE_HARASSER} from '../creeps/roles/harasser';
import {roleHarvester} from '../creeps/roles/harvester';
import {roleHauler} from '../creeps/roles/hauler';
import {roleMiner} from '../creeps/roles/miner';
import {roleRepairer} from '../creeps/roles/repairer';
import {roleReserver} from '../creeps/roles/reserver';
import {roleUpgrader} from '../creeps/roles/upgrader';
import {roleWorker} from '../creeps/roles/worker';
import {Metrics} from '../lib/metrics';
import {Tracer, TracerFields} from '../lib/tracing';
import {Kernel} from '../os/kernel/kernel';
import {Process, Runnable, RunnableResult, running, terminate} from '../os/process';
import {Scheduler} from '../os/scheduler';

export class CreepManager implements Runnable {
  id: string;

  private scheduler: Scheduler;
  private creeps: Creep[];
  private creepsByBase: Map<string, Creep[]>;
  private creepsByBaseAndRole: Map<string, Map<string, Creep[]>>;

  constructor(scheduler: Scheduler) {
    this.id = 'creep_manager';
    this.scheduler = scheduler;
    this.creepsByBase = new Map();
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('creep_manager_run');

    this.creeps = Object.values(Game.creeps);
    this.creepsByBase = _.reduce(this.creeps, (acc, creep) => {
      const base: string = creep.memory[MEMORY_BASE];
      if (!base) {
        trace.warn(`Creep ${creep.name} has no base assigned`);
        return acc;
      }

      const creeps = acc.get(base) || [];
      acc.set(base, creeps.concat([creep]));
      return acc;
    }, new Map<string, Creep[]>());

    this.creepsByBaseAndRole = _.reduce(this.creeps, (bases, creep) => {
      const base = creep.memory[MEMORY_BASE];
      if (!base) {
        return bases;
      }

      if (!bases.has(base)) {
        bases.set(base, new Map<string, Creep[]>());
      }

      const role = creep.memory[MEMORY_ROLE];
      if (!role) {
        return bases;
      }

      if (!bases.get(base).get(role)) {
        bases.get(base).set(role, []);
      }

      bases.get(base).get(role).push(creep);
      return bases;
    }, new Map<string, Map<string, Creep[]>>);

    trace.info(`Found ${this.creeps.length} creeps`);

    // TODO, make this more efficient.
    this.creeps.forEach((creep) => {
      if (creep.spawning) {
        return;
      }

      const hasProcess = this.scheduler.hasProcess(creep.name);
      if (hasProcess) {
        return;
      }

      // Check if creep has role, if not then check if near portal and get stored memory
      if (!creep.memory[MEMORY_ROLE]) {
        creep.pos.findInRange<StructurePortal>(FIND_STRUCTURES, 10, {
          filter: (structure) => {
            return structure.structureType === STRUCTURE_PORTAL;
          },
        }).forEach((portal) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const destination: any = portal.destination;
          if (destination.shard) {
            const backup = kernel.getScribe().getCreepBackup(destination.shard, creep.name);
            if (backup) {
              creep.memory = backup.memory;
            }
          }
        });
      }

      // Create processes for any creeps that do not have a process
      // registered with the scheduler
      const process = this.getCreepProcess(creep.name, creep);
      if (!process) {
        trace.error('creep has no process', {creep: creep.name, memory: creep.memory});

        const result = creep.suicide();
        if (result !== OK) {
          trace.error('suicide failed', {result, creep: creep.name, memory: creep.memory});
        }

        return;
      }

      trace.info(`Creating process for ${creep.name}`);

      this.scheduler.registerProcess(process);
    });

    if (Game.time % 100 === 0) {
      // Cleanup old creep memory
      for (const i in Memory.creeps) {
        if (!Game.creeps[i]) {
          delete Memory.creeps[i];
        }
      }
    }

    trace.end();

    return running();
  }

  getCreeps(): Creep[] {
    return this.creeps;
  }

  getCreepsByBase(baseName: string): Creep[] {
    return this.creepsByBase.get(baseName) || [];
  }

  getCreepsByBaseAndRole(base: string, role: string): Creep[] {
    return this.creepsByBaseAndRole.get(base)?.get(role) || [];
  }

  private getCreepProcess(name: string, creep: Creep): Process {
    const role = creep.memory[MEMORY_ROLE] || null;
    if (!role) {
      throw new Error(`Creep ${creep.name} has no role`);
    }

    const roleDefinition = DEFINITIONS.get(role);
    if (!roleDefinition) {
      throw new Error(`Creep ${name} has ${role} which does not have role definition`);
    }

    const behavior = this.getCreepBehavior(name, role);
    if (!behavior) {
      throw new Error(`Creep ${name} has ${role} which does not have behavior defined`);
    }

    // add 1 to the priority because creeps need to be lower priority than their manager
    const priority = roleDefinition.processPriority + 1;
    const process = new Process(name, role, priority, behavior);
    process.setSkippable(roleDefinition.skippable);

    return process;
  }

  private getCreepBehavior(name: string, role: string): Runnable {
    const behavior = this.getBehaviorByRole(role);

    return {
      run: (kernel: Kernel, trace: Tracer): RunnableResult => {
        const creep = Game.creeps[name];
        if (!creep) {
          trace.info('creep not found; terminating process', {name});
          return terminate();
        }

        const fields: TracerFields = new Map();
        fields.set('creepPos', [creep.pos.x, creep.pos.y, creep.pos.roomName].join(','));
        trace = trace.withFields(fields);

        if (creep.spawning) {
          // TODO sleep for whoever mich longer it will take to spawn
          return running();
        }

        // On first tick, set the start tick
        const startTick = creep.memory[MEMORY_START_TICK];
        if (!startTick) {
          creep.memory[MEMORY_START_TICK] = Game.time;
        }

        behavior.run(creep, trace, kernel);

        return running();
      },
    };
  }

  private roleToCreepLogic = {
    [CREEPS.WORKER_ATTACKER]: roleAttacker,
    [CREEPS.WORKER_DEFENDER]: roleDefender,
    [CREEPS.WORKER_DEFENDER_BOOSTED]: roleDefender,
    [CREEPS.WORKER_DEFENDER_DRONE]: roleDefenderDrone,
    [CREEPS.WORKER_DISTRIBUTOR]: roleDistributor,
    [CREEPS.WORKER_MINER]: roleMiner,
    [CREEPS.ROLE_WORKER]: roleWorker,
    [CREEPS.WORKER_HARVESTER]: roleHarvester,
    [CREEPS.WORKER_UPGRADER]: roleUpgrader,
    [CREEPS.WORKER_BUILDER]: roleBuilder,
    [CREEPS.WORKER_REPAIRER]: roleRepairer,
    [CREEPS.WORKER_HAULER]: roleHauler,
    [CREEPS.WORKER_RESERVER]: roleReserver,
    [CREEPS.WORKER_EXPLORER]: roleExplorer,
    [ROLE_HARASSER]: roleHarasser,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getBehaviorByRole(role: string): any {
    const behavior = this.roleToCreepLogic[role];
    if (!behavior) {
      throw new Error(`Unable to get behavior for ${role}`);
    }

    return behavior;
  }

  reportMetrics(metrics: Metrics) {
    // Report creep counts by role
    const creepsByBase = _.countBy(Game.creeps, (c) => c.memory[MEMORY_BASE])
    _.forEach(creepsByBase, (value, key) => {
      metrics.gauge(`creeps_base_total`, value, {base: key});
    });
  }
}
