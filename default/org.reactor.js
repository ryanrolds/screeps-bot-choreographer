const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');

const TASK_PHASE_LOAD = 'phase_transfer_resources'
const TASK_PHASE_REACT = 'phase_react'
const TASK_PHASE_UNLOAD = 'phase_unload'

class Reactor extends OrgBase {
  constructor(parent, labs, trace) {
    super(parent, labs[0].id, trace)

    const setupTrace = this.trace.begin('constructor');

    this.labs = labs;
    this.room = this.getRoom().getRoomObject()
    this.terminal = this.getRoom().getTerminal()
    this.task = this.getRoom().roomObject.memory[MEMORY.REACTOR_TASK] || null;

    setupTrace.end()
  }
  update() {
    console.log(this);

    if (this.task) {
      const inputA = this.task.details[MEMORY.REACTOR_INPUT_A]
      const amount = this.task.details[MEMORY.REACTOR_AMOUNT]
      const inputB = this.task.details[MEMORY.REACTOR_INPUT_B]
      const phase = this.task[MEMORY.TASK_PHASE] || TASK_PHASE_LOAD

      switch (phase) {
        case TASK_PHASE_LOAD:
          const readyA = this.prepareInput(this.labs[1], inputA, amount)
          const readyB = this.prepareInput(this.labs[2], inputB, amount)

          if (readyA && readyB) {
            this.room.memory[MEMORY.REACTOR_TASK][MEMORY.TASK_PHASE] = TASK_PHASE_REACT
            break;
          }

          break;
        case TASK_PHASE_REACT:
          if (this.labs[0].cooldown) {
            return;
          }

          const result = this.labs[0].runReaction(this.labs[1], this.labs[2])
          if (result !== OK) {
            console.log("reaction failed", this.labs[0].id, result)
            this.room.memory[MEMORY.REACTOR_TASK][MEMORY.TASK_PHASE] = TASK_PHASE_UNLOAD
          }

          break;
        case TASK_PHASE_UNLOAD:
          const lab = this.labs[0]
          if (!lab.mineralType || lab.store.getUsedCapacity(lab.mineralType) === 0) {
            this.clearTask()
            break
          }

          this.unloadLab(this.labs[0])

          break;
        default:
          console.log("BROKEN REACTION LOGIC", phase);
          this.clearTask();
      }
    }
  }
  process() {
    if (!this.getRoom().roomObject.memory[MEMORY.REACTOR_TASK]) {
      const task = this.getKingdom().getNextRequest(TOPICS.TASK_REACTION);
      if (task) {
        this.room.memory[MEMORY.REACTOR_TASK] = task;
      }
    }
  }
  toString() {
    let taskSummary = 'None';
    const task = this.getTask()
    if (task) {
      const output = task.details[MEMORY.REACTOR_OUTPUT]
      const inputA = task.details[MEMORY.REACTOR_INPUT_A]
      const inputB = task.details[MEMORY.REACTOR_INPUT_B]
      const phase = task[MEMORY.TASK_PHASE] || TASK_PHASE_LOAD

      taskSummary = `Output: ${output}, Input A: ${inputA}, Input B: ${inputB}, Phase: ${phase}`;
    }

    return `---- Reactor: Id: ${this.labs[0].id}, Task: (${taskSummary})`;
  }
  getOutput() {
    if (this.isIdle()) {
      return null
    }

    return this.getTask().details[MEMORY.REACTOR_OUTPUT]
  }
  getTask() {
    return this.room.memory[MEMORY.REACTOR_TASK] || null
  }
  isIdle() {
    return !this.getTask()
  }
  clearTask() {
    delete this.room.memory[MEMORY.REACTOR_TASK];
  }
  prepareInput(lab, resource, desiredAmount) {
    let currentAmount = 0
    if (lab.mineralType) {
      currentAmount = lab.store.getUsedCapacity(lab.mineralType)
    }

    console.log(lab.id, lab.mineralType || "none", currentAmount, resource, desiredAmount)

    // Unload the lab if it's not the right mineral
    if (lab.mineralType && lab.mineralType !== resource && lab.store.getUsedCapacity(lab.mineralType) > 0) {
      this.unloadLab(lab)
      return false
    }

    // Load the lab with the right mineral
    if (currentAmount < desiredAmount) {
      const pickup = this.getRoom().getReserveStructureWithMostOfAResource(resource, true)
      const missingAmount = desiredAmount - currentAmount

      if (!pickup) {
        this.requestResource(lab, resource, missingAmount)
      } else {
        this.loadLab(lab, pickup, resource, missingAmount)
      }

      return false
    }

    return true
  }
  requestResource(lab, resource, amount) {
    const terminal = this.getRoom().getTerminal()
    if (!terminal) {
      console.log("need to get mineral but no terminal")
      return
    }

    const result = this.getKingdom().getTerminalWithResource(resource)
    if (!result) {
      console.log("requesting purchase", lab.room.name, lab.id, resource, amount)

      const details = {
        [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
        [MEMORY.MEMORY_ORDER_TYPE]: ORDER_BUY,
        [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
        [MEMORY.MEMORY_ORDER_AMOUNT]: amount,
      };

      this.terminal.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_BUY,
        details);
      return;
    }

    const inProgress = this.getKingdom().getTerminals().filter((orgTerminal) => {
      const task = orgTerminal.getTask()
      if (!task) {
        return false
      }

      return task.details[MEMORY.TRANSFER_RESOURCE] === resource &&
        task.details[MEMORY.TRANSFER_ROOM] === lab.room.name
    }).length > 0

    if (inProgress) {
      return;
    }

    console.log("requesting transfer to room", lab.room.name, lab.id, resource, amount)

    result.terminal.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_TRANSFER, {
      [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_TRANSFER,
      [MEMORY.TRANSFER_RESOURCE]: resource,
      [MEMORY.TRANSFER_AMOUNT]: amount,
      [MEMORY.TRANSFER_ROOM]: lab.room.name,
    });
  }
  loadLab(lab, pickup, resource, amount) {
    const numHaulers = _.filter(this.getRoom().getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === resource &&
        creep.memory[MEMORY.MEMORY_HAUL_DROPOFF] === lab.id;
    }).length;

    if (numHaulers) {
      return false;
    }

    console.log("requesting load", lab.room.name, lab.id, resource, amount);

    this.getColony().sendRequest(TOPICS.TOPIC_HAUL_TASK, PRIORITIES.HAUL_REACTION, {
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
    });
  }
  unloadLab(lab) {
    const numHaulers = _.filter(this.getRoom().getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_TASK_TYPE] === TASKS.HAUL_TASK &&
        creep.memory[MEMORY.MEMORY_HAUL_RESOURCE] === lab.mineralType &&
        creep.memory[MEMORY.MEMORY_HAUL_PICKUP] === lab.id;
    }).length;

    if (numHaulers) {
      return;
    }

    const currentAmount = lab.store.getUsedCapacity(lab.mineralType);
    const dropoff = this.getRoom().getReserveStructureWithRoomForResource(lab.mineralType);

    console.log("requesting unload", lab.room.name, lab.id, lab.mineralType, currentAmount);

    this.getColony().sendRequest(TOPICS.TOPIC_HAUL_TASK, PRIORITIES.HAUL_REACTION, {
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
      [MEMORY.MEMORY_HAUL_AMOUNT]: currentAmount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
    });
  }
}

module.exports = Reactor
