import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as CREEPS from "./constants.creeps"
import * as PRIORITIES from "./constants.priorities"

const TASK_PHASE_LOAD = 'phase_transfer_resources';
const TASK_PHASE_REACT = 'phase_react';
const TASK_PHASE_UNLOAD = 'phase_unload';
const TASK_TTL = 300;

const REQUEST_LOAD_TTL = 20;
const REQUEST_UNLOAD_TTL = 20;
const REACTION_TTL = 0;
const NO_SLEEP = 0;

export default class ReactorRunnable {
  id: string;
  orgRoom: OrgRoom;
  labIds: Id<StructureLab>[];

  prevTime: number;

  constructor(id: string, orgRoom: OrgRoom, labIds: Id<StructureLab>[]) {
    this.id = id;
    this.orgRoom = orgRoom;
    this.labIds = labIds;

    this.prevTime = Game.time;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    const ticks = Game.time - this.prevTime;

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.log(this.id, "room not found - terminating", {});
      return terminate();
    }

    let labs = this.labIds.map(labId => Game.getObjectById(labId));
    if (_.filter(labs, lab => !lab).length) {
      trace.log(this.id, 'lab missing - terminating', {labIds: this.labIds})
      return terminate();
    }

    let task = room.memory[this.getTaskMemoryId()] || null;
    if (!task) {
      const task = (this.orgRoom as any).getKingdom().getNextRequest(TOPICS.TASK_REACTION);
      if (task) {
        room.memory[this.getTaskMemoryId()] = task;
      }
    }

    trace.log(this.id, 'reactor run', {
      labIds: this.labIds,
      ticks,
      task,
    });

    if (task) {
      const sleepFor = this.processTask(room, labs, task)
      if (sleepFor) {
        return sleeping(sleepFor);
      }
    }

    return running();
  }

  getOutput() {
    if (this.isIdle()) {
      return null;
    }

    return this.getTask().details[MEMORY.REACTOR_OUTPUT];
  }
  getTaskMemoryId() {
    return `${MEMORY.REACTOR_TASK}_${this.labIds[0]}`;
  }
  getTask() {
    const room = this.orgRoom.getRoomObject();
    if (!room) {
      return null;
    }

    return room.memory[this.getTaskMemoryId()] || null;
  }
  isIdle() {
    return !this.getTask();
  }
  clearTask() {
    const room = this.orgRoom.getRoomObject();
    if (!room) {
      return;
    }

    delete room.memory[this.getTaskMemoryId()];
  }

  processTask(room: Room, labs: StructureLab[], task): number {
    const inputA = task.details[MEMORY.REACTOR_INPUT_A];
    const amount = task.details[MEMORY.REACTOR_AMOUNT];
    const inputB = task.details[MEMORY.REACTOR_INPUT_B];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_LOAD;

    switch (phase) {
      case TASK_PHASE_LOAD:
        // Maintain task TTL. We want to abort hard to perform tasks
        let ttl = task[MEMORY.REACTOR_TTL];
        if (ttl === undefined) {
          ttl = TASK_TTL;
        }
        if (ttl <= 0) {
          this.clearTask();
          return NO_SLEEP;
        } else {
          room.memory[this.getTaskMemoryId()][MEMORY.REACTOR_TTL] = ttl - 1;
        }

        const readyA = this.prepareInput(labs[1], inputA, amount);
        const readyB = this.prepareInput(labs[2], inputB, amount);

        if (readyA && readyB) {
          room.memory[this.getTaskMemoryId()][MEMORY.TASK_PHASE] = TASK_PHASE_REACT;
          return NO_SLEEP;
        }

        return REQUEST_LOAD_TTL;
      case TASK_PHASE_REACT:
        if (labs[0].cooldown) {
          return labs[0].cooldown;
        }

        const result = labs[0].runReaction(labs[1], labs[2]);
        if (result !== OK) {
          room.memory[this.getTaskMemoryId()][MEMORY.TASK_PHASE] = TASK_PHASE_UNLOAD;
        }

        return REACTION_TTL;
      case TASK_PHASE_UNLOAD:
        const lab = labs[0];
        if (!lab.mineralType || lab.store.getUsedCapacity(lab.mineralType) === 0) {
          this.clearTask();
          break;
        }

        this.unloadLab(labs[0]);

        return REQUEST_UNLOAD_TTL;
      default:
        console.log('BROKEN REACTION LOGIC', phase);
        this.clearTask();
        return NO_SLEEP;
    }
  }

  unloadLabs(labs: StructureLab[]) {
    labs.forEach((lab) => {
      if (lab.mineralType) {
        this.unloadLab(lab);
      }
    });
  }

  prepareInput(lab: StructureLab, resource, desiredAmount: number) {
    let currentAmount = 0;
    if (lab.mineralType) {
      currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    }

    // Unload the lab if it's not the right mineral
    if (lab.mineralType && lab.mineralType !== resource && lab.store.getUsedCapacity(lab.mineralType) > 0) {
      this.unloadLab(lab);
      return false;
    }

    // Load the lab with the right mineral
    if (currentAmount < desiredAmount) {
      const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(resource, true);
      const missingAmount = desiredAmount - currentAmount;

      if (!pickup) {
        // TODO this really should use topics/IPC
        (this.orgRoom as any).getKingdom().getResourceGovernor()
          .requestResource(this.orgRoom, resource, missingAmount, REQUEST_LOAD_TTL);
      } else {
        this.loadLab(lab, pickup, resource, missingAmount);
      }

      return false;
    }

    return true;
  }

  loadLab(lab: StructureLab, pickup: AnyStoreStructure, resource: ResourceConstant, amount: number) {
    (this.orgRoom as any).getColony().sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_REACTION, {
      [MEMORY.TASK_ID]: `load-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
    }, REQUEST_LOAD_TTL);
  }

  unloadLab(lab) {
    const currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    const dropoff = this.orgRoom.getReserveStructureWithRoomForResource(lab.mineralType);

    (this.orgRoom as any).getColony().sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_REACTION, {
      [MEMORY.TASK_ID]: `unload-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
      [MEMORY.MEMORY_HAUL_AMOUNT]: currentAmount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
    }, REQUEST_LOAD_TTL);
  }
}
