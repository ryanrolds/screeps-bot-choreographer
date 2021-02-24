
const doEvery = (ttl, memory, key) => (action) => {
  let lastCall = 0;

  if (memory && key) {
    lastCall = memory[key] || 0;
  }

  const tick = function(...args) {
    if (lastCall + ttl <= Game.time) {
      lastCall = Game.time;

      if (memory && key) {
        memory[key] = lastCall;
      }

      return action(...args);
    }

    return null;
  };

  tick.reset = () => {
    lastCall = 0;
  };

  return tick;
};

const STATUS_RUNNING = 'running';
const STATUS_SLEEPING = 'sleeping';
const STATUS_STOPPED = 'stopped';
const STATUS_TERMINATED = 'terminated';

const processTable = [];

class Process {
  constructor(id, runnable) {
    this.id = id;
    this.runnable = runnable;

    this.status = STATUS_RUNNING;
    this.lastRun = 0;
    this.nextRun = 0;
  }

  isReady() {
    this.runnable.isReady();
  }

  getPriority() {
    this.runnable.getPriority();
  }

  run() {
    return this.runnable.run();
  }
}

const registerProcess = (id, runnable, priority) => {
  processTable.push(new Process(id, runnable, priority));
};

const run = (trace) => {
  // Sort process table priority
  // -1 should maintain the same order
  processTable = _.sortBy(processTable, 'priority');

  // Iterate processes and act on their status
  processTable.forEach((process) => {
    let status = process.status;
    switch (status) {
      case STATUS_RUNNING:
        // Run the process
        status = process.run();

        // Update the process status
        break;
      case STATUS_SLEEPING:
        if (Game.time >= process.sleepUntil) {
          process.status = STATUS_RUNNING;
          process.sleepUntil = 0;
        }

        break;
      case STATUS_STOPPED:
        break;
      case STATUS_TERMINATED:
        break;
      default:
      //console.log("bad status", result.status)
    }
  })
};

module.exports = {
  // V1 bad scheduler
  doEvery,
  // V2 scheduler
  run,
  registerProcess,
  STATUS_RUNNING,
  STATUS_SLEEPING,
  STATUS_STOPPED,
  STATUS_TERMINATED,
};
