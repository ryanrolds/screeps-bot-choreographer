import * as CREEPS from './constants.creeps';
import {DEFINITIONS} from './constants.creeps';
import {MEMORY_ASSIGN_ROOM, MEMORY_BASE, MEMORY_ROLE, MEMORY_START_TICK} from './constants.memory';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import {Process, running, terminate} from "./os.process";
import {Runnable, RunnableResult} from './os.runnable';
import {Scheduler} from "./os.scheduler";
import roleAttacker from './role.attacker';
import {roleBuilder} from './role.builder';
import {roleDefender} from './role.defender';
import roleDefenderDrone from './role.defender_drone';
import {roleDistributor} from './role.distributor';
import roleExplorer from './role.explorer';
import {roleHarasser, ROLE_HARASSER} from './role.harasser';
import {roleHarvester} from './role.harvester';
import {roleHauler} from './role.hauler';
import {roleMiner} from './role.miner';
import {roleRepairer} from './role.repairer';
import {roleReserver} from './role.reserver';
import {roleUpgrader} from './role.upgrader';
import {roleWorker} from './role.worker';

export class CreepManager {
  id: string;

  private scheduler: Scheduler;
  private creeps: Creep[];
  private creepsByRoom: Record<string, Creep[]>;
  private creepsByBase: Record<string, Creep[]>;
  private creepCountsByBaseAndRole: Record<string, Record<string, Creep[]>>;

  constructor(scheduler: Scheduler) {
    this.id = 'creep_manager';
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('creep_manager_run');

    this.creeps = Object.values(Game.creeps);
    this.creepsByRoom = _.groupBy(this.creeps, (creep) => {
      if (!creep.memory[MEMORY_ASSIGN_ROOM]) {
        trace.warn(`Creep ${creep.name} has no room assigned`);
      }
      return creep.memory[MEMORY_ASSIGN_ROOM];
    });
    this.creepsByBase = _.groupBy(this.creeps, (creep) => {
      if (!creep.memory[MEMORY_BASE]) {
        trace.warn(`Creep ${creep.name} has no base assigned`);
      }
      return creep.memory[MEMORY_BASE];
    });

    this.creepCountsByBaseAndRole = _.reduce(this.creeps, (bases, creep) => {
      const base = creep.memory[MEMORY_BASE]
      if (!base) {
        return bases;
      }

      if (!bases[base]) {
        bases[base] = {};
      }

      const role = creep.memory[MEMORY_ROLE];
      if (!role) {
        return bases;
      }

      if (!bases[base][role]) {
        bases[base][role] = [];
      }

      bases[base][role].push(creep);
      return bases;
    }, {} as Record<string, Record<string, Creep[]>>)

    // Create processes for any creeps that do not have a process
    // registered with the scheduler

    // TODO, make this more efficient.
    this.creeps.forEach((creep) => {
      if (creep.spawning) {
        return;
      }

      const hasProcess = this.scheduler.hasProcess(creep.id);
      if (hasProcess) {
        return;
      }

      // Check if creep has role, if not then check if near portal and get stored memory
      if (!creep.memory[MEMORY_ROLE]) {
        creep.pos.findInRange<StructurePortal>(FIND_STRUCTURES, 10, {
          filter: (structure) => {
            return structure.structureType === STRUCTURE_PORTAL;
          }
        }).forEach((portal) => {
          const destination: any = portal.destination

          if (destination.shard) {
            const backup = kingdom.getScribe().getCreepBackup(destination.shard, creep.name)
            if (backup) {
              creep.memory = backup.memory;
            }
          }
        })
      }

      const process = this.getCreepProcess(creep.id, creep);
      if (!process) {
        trace.error('creep has no process', {creep: creep.name, memory: creep.memory});
        let result = creep.suicide();
        if (result !== OK) {
          trace.error('suicide failed', {result, creep: creep.name, memory: creep.memory})
        }

        return;
      }

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

  getCreepsByRoom(roomName: string): Creep[] {
    return this.creepsByRoom[roomName] || [];
  }

  getCreepsByBase(baseName: string): Creep[] {
    return this.creepsByBase[baseName] || [];
  }

  getCreepsByBaseAndRole(base: string, role: string): Creep[] {
    return _.get(this.creepCountsByBaseAndRole, [base, role], []);
  }

  private getCreepProcess(id: string, creep: Creep): Process {
    const role = creep.memory[MEMORY_ROLE] || null;
    if (!role) {
      return null;
    }

    const roleDefinition = DEFINITIONS[role];
    if (!roleDefinition) {
      throw new Error(`Creep ${id} has ${role} which does not have role definition`)
    }

    const behavior = this.getCreepBehavior(id, role)
    if (!behavior) {
      throw new Error(`Creep ${id} has ${role} which does not have behavior defined`);
    }

    // add 1 to the priority because creeps need to be lower priority than their manager
    const priority = roleDefinition.processPriority + 1;
    const process = new Process(id, role, priority, behavior)
    process.setSkippable(roleDefinition.skippable);

    return process;
  }

  private getCreepBehavior(id: string, role: string): Runnable {
    const behavior = this.getBehaviorByRole(role);

    return {
      run: (kingdom: Kingdom, trace: Tracer): RunnableResult => {
        const creep = Game.creeps[id];
        if (!creep) {
          trace.log("creep not found; terminating process", {})
          return terminate();
        }

        trace = trace.withFields({
          creepPos: [creep.pos.x, creep.pos.y, creep.pos.roomName].join(','),
        })

        if (creep.spawning) {
          // TODO sleep for whoever mich longer it will take to spawn
          return running();
        }

        // On first tick, set the start tick
        const startTick = creep.memory[MEMORY_START_TICK];
        if (!startTick) {
          creep.memory[MEMORY_START_TICK] = Game.time;
        }

        behavior.run(creep, trace, kingdom)

        return running();
      }
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

  private getBehaviorByRole(role: string): any {
    const behavior = this.roleToCreepLogic[role]
    if (!behavior) {
      throw new Error(`Unable to get behavior for ${role}`)
    }

    return behavior
  }
}
