const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');
const {doEvery} = require('./lib.scheduler');

const TASK_PHASE_LOAD = 'phase_transfer_resources';
const TASK_PHASE_REACT = 'phase_react';
const TASK_PHASE_UNLOAD = 'phase_unload';

const REQUEST_RESOURCE_TTL = 20;
const REQUEST_LOAD_TTL = 10;
const REQUEST_UNLOAD_TTL = 10;
const TASK_TTL = 300;

class Reactor extends OrgBase {
  constructor(parent, labs, trace) {
    super(parent, labs[0].id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.labs = labs;
    this.room = this.getRoom().getRoomObject();
    this.terminal = this.getRoom().getTerminal();
    this.task = this.room.memory[MEMORY.REACTOR_TASK] || null;

    this.doRequestResource = doEvery(REQUEST_RESOURCE_TTL)((room, resource, missingAmount, ttl) => {
      this.getKingdom().getResourceGovernor().requestResource(room, resource, missingAmount, ttl);
    });

    this.doLoadLab = doEvery(REQUEST_LOAD_TTL)((lab, pickup, resource, missingAmount) => {
      this.loadLab(lab, pickup, resource, missingAmount);
    });

    this.doUnloadLab = doEvery(REQUEST_UNLOAD_TTL)((lab) => {
      this.unloadLab(lab);
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.labs = this.labs.map((lab) => {
      return Game.getObjectById(lab.id);
    }).filter((lab) => {
      return lab
    });

    if (this.labs.length != 3) {
      console.log(`not enough labs (${this.labs.length}) to form reactor`);
      updateTrace.end();
      return;
    }

    this.room = this.getRoom().getRoomObject();
    this.terminal = this.getRoom().getTerminal();
    this.task = this.room.memory[MEMORY.REACTOR_TASK] || null;

    // console.log(this);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    if (!this.task) {
      const task = this.getKingdom().getNextRequest(TOPICS.TASK_REACTION);
      if (task) {
        this.room.memory[MEMORY.REACTOR_TASK] = task;
        this.task = task;
      }
    }

    if (this.task) {
      const inputA = this.task.details[MEMORY.REACTOR_INPUT_A];
      const amount = this.task.details[MEMORY.REACTOR_AMOUNT];
      const inputB = this.task.details[MEMORY.REACTOR_INPUT_B];
      const phase = this.task[MEMORY.TASK_PHASE] || TASK_PHASE_LOAD;

      switch (phase) {
        case TASK_PHASE_LOAD:
          // Maintain task TTL. We want to abort hard to perform tasks
          let ttl = this.task[MEMORY.REACTOR_TTL];
          if (ttl === undefined) {
            ttl = TASK_TTL;
          }
          if (ttl <= 0) {
            this.clearTask();
            return;
          } else {
            this.room.memory[MEMORY.REACTOR_TASK][MEMORY.REACTOR_TTL] = ttl - 1;
          }

          const readyA = this.prepareInput(this.labs[1], inputA, amount);
          const readyB = this.prepareInput(this.labs[2], inputB, amount);

          if (readyA && readyB) {
            this.room.memory[MEMORY.REACTOR_TASK][MEMORY.TASK_PHASE] = TASK_PHASE_REACT;
            break;
          }

          break;
        case TASK_PHASE_REACT:
          if (this.labs[0].cooldown) {
            return;
          }

          const result = this.labs[0].runReaction(this.labs[1], this.labs[2]);
          if (result !== OK) {
            this.room.memory[MEMORY.REACTOR_TASK][MEMORY.TASK_PHASE] = TASK_PHASE_UNLOAD;
          }

          break;
        case TASK_PHASE_UNLOAD:
          const lab = this.labs[0];
          if (!lab.mineralType || lab.store.getUsedCapacity(lab.mineralType) === 0) {
            this.clearTask();
            break;
          }

          this.doUnloadLab(this.labs[0]);

          break;
        default:
          console.log('BROKEN REACTION LOGIC', phase);
          this.clearTask();
      }
    } else {
      this.labs.forEach((lab) => {
        if (lab.mineralType) {
          this.doUnloadLab(lab);
        }
      });
    }

    processTrace.end();
  }
  toString() {
    let taskSummary = 'None';
    const task = this.getTask();
    if (task) {
      const output = task.details[MEMORY.REACTOR_OUTPUT];
      const inputA = task.details[MEMORY.REACTOR_INPUT_A];
      const inputB = task.details[MEMORY.REACTOR_INPUT_B];
      const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_LOAD;
      const ttl = task[MEMORY.REACTOR_TTL];

      taskSummary = `Output: ${output}, Input A: ${inputA}, Input B: ${inputB}, ` +
        `Phase: ${phase}, TTL: ${ttl}`;
    }

    return `---- Reactor: Id: ${this.labs[0].id}, Task: (${taskSummary})`;
  }
  getOutput() {
    if (this.isIdle()) {
      return null;
    }

    return this.getTask().details[MEMORY.REACTOR_OUTPUT];
  }
  getTask() {
    return this.room.memory[MEMORY.REACTOR_TASK] || null;
  }
  isIdle() {
    return !this.getTask();
  }
  clearTask() {
    delete this.room.memory[MEMORY.REACTOR_TASK];
  }
  prepareInput(lab, resource, desiredAmount) {
    let currentAmount = 0;
    if (lab.mineralType) {
      currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    }

    // Unload the lab if it's not the right mineral
    if (lab.mineralType && lab.mineralType !== resource && lab.store.getUsedCapacity(lab.mineralType) > 0) {
      this.doUnloadLab(lab);
      return false;
    }

    const room = this.getRoom();

    // Load the lab with the right mineral
    if (currentAmount < desiredAmount) {
      const pickup = room.getReserveStructureWithMostOfAResource(resource, true);
      const missingAmount = desiredAmount - currentAmount;

      if (!pickup) {
        console.log('requesting', this.room.name, resource, missingAmount);
        this.doRequestResource(room, resource, missingAmount, REQUEST_RESOURCE_TTL);
      } else {
        this.doLoadLab(lab, pickup, resource, missingAmount);
      }

      return false;
    }

    return true;
  }
  loadLab(lab, pickup, resource, amount) {
    const numHaulers = this.getRoom().getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === resource &&
        creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] === lab.id;
    }).length;

    if (numHaulers) {
      return false;
    }

    this.getColony().sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_REACTION, {
      [MEMORY.TASK_ID]: `load-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
    }, REQUEST_LOAD_TTL);
  }
  unloadLab(lab) {
    const numHaulers = this.getRoom().getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === lab.mineralType &&
        creep.memory[MEMORY.MEMORY_HAUL_PICKUP] === lab.id;
    }).length;

    if (numHaulers) {
      return;
    }

    const currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    const dropoff = this.getRoom().getReserveStructureWithRoomForResource(lab.mineralType);

    this.getColony().sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_REACTION, {
      [MEMORY.TASK_ID]: `unload-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
      [MEMORY.MEMORY_HAUL_AMOUNT]: currentAmount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
    }, REQUEST_LOAD_TTL);
  }
}

module.exports = Reactor;
