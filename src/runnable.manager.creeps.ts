
import * as CREEPS from './constants.creeps';
import {DEFINITIONS} from './constants.creeps';
import {MEMORY_ROLE, MEMORY_START_TICK} from './constants.memory';
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
import {roleHarvester} from './role.harvester';
import {roleHauler} from './role.hauler';
import {roleMiner} from './role.miner';
import {roleRepairer} from './role.repairer';
import {roleReserver} from './role.reserver';
import {roleUpgrader} from './role.upgrader';
import {roleWorker} from './role.worker';

export class CreepManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('creep_manager_run');

    // Create processes for any creeps that do not have a process
    // registered with the scheduler

    // TODO, make this more efficient.
    Object.entries(Game.creeps).forEach(([id, creep]) => {
      const hasProcess = this.scheduler.hasProcess(id);
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

      const process = this.getCreepProcess(id, creep);
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

  private getCreepProcess(id: string, creep: Creep): Process {
    const role = creep.memory[MEMORY_ROLE] || null;
    if (!role) {
      throw new Error(`Creep ${id} has no role`);
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
    [CREEPS.WORKER_ATTACKER_1TOWER]: roleAttacker,
    [CREEPS.WORKER_ATTACKER_2TOWER]: roleAttacker,
    [CREEPS.WORKER_ATTACKER_3TOWER]: roleAttacker,
    [CREEPS.WORKER_ATTACKER_6TOWER]: roleAttacker,
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
  }

  private getBehaviorByRole(role: string): any {
    const behavior = this.roleToCreepLogic[role]
    if (!behavior) {
      throw new Error(`Unable to get behavior for ${role}`)
    }

    return behavior
  }
}
