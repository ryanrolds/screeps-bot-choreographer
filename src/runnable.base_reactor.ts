import {Base, getBasePrimaryRoom, getStructureForResource, getStructureWithResource} from './base';
import {BaseRoomThreadFunc, threadBaseRoom} from './base_room';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import {Kernel} from './kernel';
import {Event} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {PersistentMemory} from './os.memory';
import {running, sleeping, terminate} from './os.process';
import {RunnableResult} from './os.runnable';
import {getBaseDistributorTopic} from './role.distributor';

const TASK_PHASE_START = 'phase_start';
const TASK_PHASE_LOAD = 'phase_transfer_resources';
export const TASK_PHASE_REACT = 'phase_react';
const TASK_PHASE_UNLOAD = 'phase_unload';
const TASK_TTL = 25;

const REQUEST_LOAD_TTL = 20;
const REQUEST_UNLOAD_TTL = 20;
const REACTION_TTL = 0;
const NO_SLEEP = 0;
const NEW_TASK_SLEEP = 10;
const PRODUCE_STATUS_TTL = 25;

// Deprecated
export const REACTION_UPDATE_TOPIC = 'reaction_updates';

export const REACTION_STATUS_STREAM = 'stream_reaction_status';
export const REACTION_STATUS_START = 'reaction_status_start';
export const REACTION_STATUS_UPDATE = 'reaction_status_update';
export const REACTION_STATUS_STOP = 'reaction_status_stop';

type ReactorTask = {
  [MEMORY.TASK_ID]: string
  [MEMORY.MEMORY_TASK_TYPE]: string
  [MEMORY.MEMORY_HAUL_PICKUP]: Id<StructureConstant>
  [MEMORY.MEMORY_HAUL_RESOURCE]: ResourceConstant
  [MEMORY.MEMORY_HAUL_AMOUNT]: number
  [MEMORY.MEMORY_HAUL_DROPOFF]: Id<StructureConstant>
  [MEMORY.REACTOR_TTL]: number
}

export default class ReactorRunnable extends PersistentMemory {
  id: string;
  baseId: string;
  labIds: Id<StructureLab>[];
  prevTime: number;

  threadProduceStatus: BaseRoomThreadFunc;

  constructor(id: string, baseId: string, labIds: Id<StructureLab>[]) {
    super(id);

    this.id = id;
    this.baseId = baseId;
    this.labIds = labIds;
    this.prevTime = Game.time;

    this.threadProduceStatus = threadBaseRoom('produce_status_thread',
      PRODUCE_STATUS_TTL)(this.produceUpdateStatus.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('reactor_run');

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.info('base not found');
      trace.end();
      return terminate();
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.info('room not found - terminating', {});
      trace.end();
      return sleeping(50);
    }

    const labs = this.labIds.map((labId) => Game.getObjectById(labId));
    if (_.filter(labs, (lab) => !lab).length) {
      trace.info('lab missing - terminating', {labIds: this.labIds});
      trace.end();
      return terminate();
    }

    let task = this.getTask(trace);
    if (!task) {
      trace.info('no current task', {});

      const request = kernel.getTopics().getNextRequest(TOPICS.TASK_REACTION);
      if (!request) {
        trace.info('no available tasks', {});
        trace.end();
        return sleeping(NEW_TASK_SLEEP);
      }

      task = {
        [MEMORY.TASK_ID]: `unload-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: request.details[MEMORY.MEMORY_HAUL_PICKUP],
        [MEMORY.MEMORY_HAUL_RESOURCE]: request.details[MEMORY.MEMORY_HAUL_RESOURCE],
        [MEMORY.MEMORY_HAUL_AMOUNT]: request.details[MEMORY.MEMORY_HAUL_AMOUNT],
        [MEMORY.MEMORY_HAUL_DROPOFF]: request.details[MEMORY.MEMORY_HAUL_DROPOFF],
        [MEMORY.REACTOR_TTL]: TASK_TTL,
      };
      this.setTask(task);

      trace.info('got new task', {task});
    }

    this.threadProduceStatus(trace, kernel, base, room, labs, task);

    trace.info('reactor run', {
      labIds: this.labIds,
      ticks,
      task,
    });

    if (task) {
      let sleepFor = 0;
      [task, sleepFor] = this.processTask(kernel, base, room, labs, task, ticks, trace);
      this.setTask(task);

      if (sleepFor) {
        trace.end();
        return sleeping(sleepFor);
      }
    }

    trace.end();
    return running();
  }

  getOutput(trace: Tracer) {
    if (this.isIdle(trace)) {
      return null;
    }

    return this.getTask(trace)[MEMORY.REACTOR_OUTPUT];
  }
  getTaskMemoryId() {
    return `${MEMORY.REACTOR_TASK}`;
  }

  getTask(trace: Tracer): ReactorTask {
    const memory = this.getMemory(trace);
    if (!memory) {
      return null;
    }

    return memory[this.getTaskMemoryId()] || null;
  }

  setTask(task: ReactorTask) {
    this.setMemory({
      [this.getTaskMemoryId()]: task,
    });
  }

  isIdle(trace: Tracer) {
    return !this.getTask(trace);
  }

  clearTask(trace: Tracer) {
    const memory = this.getMemory(trace);
    if (!memory) {
      return;
    }

    delete memory[this.getTaskMemoryId()];
    this.setMemory(memory);
  }

  // TODO create type for task
  processTask(kernel: Kernel, base: Base, room: Room, labs: StructureLab[], task: ReactorTask,
    ticks: number, trace: Tracer): [ReactorTask, number] {
    const inputA = task[MEMORY.REACTOR_INPUT_A];
    const amount = task[MEMORY.REACTOR_AMOUNT];
    const inputB = task[MEMORY.REACTOR_INPUT_B];
    const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_START;

    switch (phase) {
      case TASK_PHASE_START:
        trace.info('starting task', {task});

        task[MEMORY.TASK_PHASE] = TASK_PHASE_LOAD;
      // eslint-disable-next-line no-fallthrough
      case TASK_PHASE_LOAD: {
        // Maintain task TTL. We want to abort hard to perform tasks
        let ttl = task[MEMORY.REACTOR_TTL];
        // Check if we have lowered the TTL and use the new one
        if (ttl > TASK_TTL) {
          ttl = TASK_TTL;
        }

        if (ttl <= 0) {
          trace.info('ttl exceeded, clearing task', {});
          this.clearTask(trace);
          return [task, NO_SLEEP];
        } else {
          task[MEMORY.TASK_PHASE] = TASK_PHASE_LOAD;
          task[MEMORY.REACTOR_TTL] = ttl - ticks;
        }

        const readyA = this.prepareInput(kernel, base, labs[1], inputA, amount, trace);
        const readyB = this.prepareInput(kernel, base, labs[2], inputB, amount, trace);

        if (readyA && readyB) {
          trace.info('loaded, moving to react phase', {});
          task[MEMORY.TASK_PHASE] = TASK_PHASE_REACT;
          return [task, NO_SLEEP];
        }

        return [task, REQUEST_LOAD_TTL];
      }
      case TASK_PHASE_REACT: {
        if (labs[0].cooldown) {
          trace.info('reacting cooldown', {cooldown: labs[0].cooldown});
          return [task, labs[0].cooldown];
        }

        const result = labs[0].runReaction(labs[1], labs[2]);
        if (result !== OK) {
          trace.info('reacted, moving to unload phase', {});
          task[MEMORY.TASK_PHASE] = TASK_PHASE_UNLOAD;
          return [task, NO_SLEEP];
        }

        return [task, REACTION_TTL];
      }
      case TASK_PHASE_UNLOAD: {
        const lab = labs[0];
        if (!lab.mineralType || lab.store.getUsedCapacity(lab.mineralType) === 0) {
          trace.info('unloaded, task complete', {});
          this.clearTask(trace);
          return [task, NO_SLEEP];
        }

        this.unloadLab(kernel, base, labs[0], trace);

        return [task, REQUEST_UNLOAD_TTL];
      }
      default:
        trace.error('BROKEN REACTION LOGIC', phase);
        this.clearTask(trace);
        return [task, NO_SLEEP];
    }
  }

  unloadLabs(kernel: Kernel, base: Base, labs: StructureLab[], trace: Tracer) {
    labs.forEach((lab) => {
      if (lab.mineralType) {
        this.unloadLab(kernel, base, lab, trace);
      }
    });
  }

  prepareInput(kernel: Kernel, base: Base, lab: StructureLab, resource, desiredAmount: number, trace: Tracer) {
    let currentAmount = 0;
    if (lab.mineralType) {
      currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    }

    // Unload the lab if it's not the right mineral
    if (lab.mineralType && lab.mineralType !== resource && lab.store.getUsedCapacity(lab.mineralType) > 0) {
      this.unloadLab(kernel, base, lab, trace);
      return false;
    }

    // Load the lab with the right mineral
    if (currentAmount < desiredAmount) {
      const pickup = getStructureWithResource(base, resource);
      const missingAmount = desiredAmount - currentAmount;

      if (!pickup) {
        this.requestResource(kernel, base, resource, missingAmount, trace);
      } else {
        this.loadLab(kernel, lab, pickup, resource, missingAmount, trace);
      }

      return false;
    }

    return true;
  }

  requestResource(kernel: Kernel, base: Base, resource: ResourceConstant, amount: number, trace: Tracer) {
    // TODO this really should use topics/IPC
    trace.info('requesting resource from governor', {resource, amount});

    const resourceManager = kernel.getResourceManager();
    const requested = resourceManager.requestResource(base, resource, amount, REQUEST_LOAD_TTL, trace);
    if (!requested) {
      resourceManager.buyResource(base, resource, amount, REQUEST_LOAD_TTL, trace);
    }
  }

  loadLab(kernel: Kernel, lab: StructureLab, pickup: AnyStoreStructure, resource: ResourceConstant, amount: number, trace: Tracer) {
    trace.info('requesting load', {
      lab: lab.id,
      resource: resource,
      amount: amount,
      pickup: pickup.id,
      ttl: REQUEST_LOAD_TTL,
    });

    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_REACTION, {
      [MEMORY.TASK_ID]: `load-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
    }, REQUEST_LOAD_TTL);
  }

  unloadLab(kernel: Kernel, base: Base, lab, trace: Tracer) {
    const currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    const dropoff = getStructureForResource(base, lab.mineralType);

    trace.info('requesting unload', {
      lab: lab.id,
      resource: lab.mineralType,
      amount: currentAmount,
      dropoff: dropoff.id,
      ttl: REQUEST_LOAD_TTL,
    });

    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_REACTION, {
      [MEMORY.TASK_ID]: `unload-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
      [MEMORY.MEMORY_HAUL_AMOUNT]: currentAmount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
    }, REQUEST_LOAD_TTL);
  }

  produceUpdateStatus(trace: Tracer, kernel: Kernel, base: Base, room: Room,
    labs: StructureLab[], task: ReactorTask) {
    if (!task) {
      trace.info('no task', {baseId: this.baseId});
      return;
    }

    const resource = task[MEMORY.REACTOR_OUTPUT] || null;
    const phase = task[MEMORY.TASK_PHASE] || null;
    const amount = labs[0]?.store.getUsedCapacity(task[MEMORY.REACTOR_OUTPUT]) || 0;

    // TODO add reactor status and reactor task
    const status = {
      [MEMORY.REACTION_STATUS_ROOM]: room.name,
      [MEMORY.REACTION_STATUS_LAB]: labs[0].id,
      [MEMORY.REACTION_STATUS_RESOURCE]: resource,
      [MEMORY.REACTION_STATUS_RESOURCE_AMOUNT]: amount,
      [MEMORY.REACTION_STATUS_PHASE]: phase,
    };

    trace.info('producing reactor status', {status});

    kernel.getTopics().addRequest(TOPICS.ACTIVE_REACTIONS, 1, status, PRODUCE_STATUS_TTL);

    // @REFACTOR there *may* be a bug here. I don't think it's calling stop
    if (resource) {
      kernel.getBroker().getStream(REACTION_STATUS_STREAM).
        publish(new Event(this.id, Game.time, REACTION_STATUS_UPDATE, status));
    } else {
      kernel.getBroker().getStream(REACTION_STATUS_STREAM).
        publish(new Event(this.id, Game.time, REACTION_STATUS_STOP, {}));
    }
  }
}
