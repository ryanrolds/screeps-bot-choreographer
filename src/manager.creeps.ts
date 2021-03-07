
import * as _ from 'lodash';

import {Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from './org.kingdom';

import {MEMORY_ROLE} from './constants.memory';
import * as CREEPS from './constants.creeps';
import {definitions} from './constants.creeps';

import roleHarvester from './role.harvester';
import roleUpgrader from './role.upgrader';
import roleBuilder from './role.builder';
import roleRepairer from './role.repairer';
import roleHauler from './role.hauler';
import roleMiner from './role.miner';
import roleDistributor from './role.distributor';
import roleDefender from './role.defender';
import roleAttacker from './role.attacker';
import roleReserver from './role.reserver';
import roleExplorer from './role.explorer';


export class CreepManager {
  scheduler: Scheduler;

  constructor(scheduler: Scheduler) {
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Create processes for any creeps that do not have a process
    // registered with the scheduler

    // TODO, make this more efficient. Currently n^2
    Object.entries(Game.creeps).forEach(([id, creep]) => {
      const hasProcess = this.scheduler.hasProcess(id);
      if (hasProcess) {
        return;
      }

      const process = this.getCreepProcess(id, creep);
      this.scheduler.registerProcess(process);
    });

    return running();
  }

  private getCreepProcess(id: string, creep: Creep): Process {
    const role = creep.memory[MEMORY_ROLE] || null;
    if (!role) {
      throw new Error(`Creep ${id} has no role`);
    }

    const roleDefinition = definitions[role];
    if (!roleDefinition) {
      throw new Error(`Creep ${id} has $${role} which does not have role definition`)
    }

    const priority = definitions[role].processPriority;

    const behavior = this.getCreepBehavior(id, role)
    if (!behavior) {
      throw new Error(`Creep ${id} has ${role} which does not have behavior defined`);
    }

    return new Process(id, priority, behavior)
  }

  private getCreepBehavior(id: string, role: string): Runnable {
    const behavior = this.getBehaviorByRole(role);

    return {
      run: (kingdom: Kingdom, trace: Tracer): RunnableResult => {
        const creep = Game.creeps[id];
        if (!creep) {
          trace.log(id, "creep not found; terminating process", {})
          return terminate();
        }

        if (creep.spawning) {
          // TODO sleep for whoever mich longer it will take to spawn
          return running();
        }

        behavior.run(creep, trace, kingdom)

        return running();
      }
    };
  }

  private roleToCreepLogic = {
    [CREEPS.WORKER_ATTACKER]: roleAttacker,
    [CREEPS.WORKER_DEFENDER]: roleDefender,
    [CREEPS.WORKER_DISTRIBUTOR]: roleDistributor,
    [CREEPS.WORKER_MINER]: roleMiner,
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
