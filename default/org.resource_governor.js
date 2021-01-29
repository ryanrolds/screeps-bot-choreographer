const OrgBase = require('./org.base');
const TOPICS = require('./constants.topics');
const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const PRIORITIES = require('./constants.priorities');

const RESERVE_LIMIT = 5000;
const REACTION_BATCH_SIZE = 1000;

class Resources extends OrgBase {
  constructor(parent, trace) {
    super(parent, 'resources', trace);

    const setupTrace = this.trace.begin('constructor');

    this.resources = this.getKingdom().getReserveResources(true);
    this.activeReactions = this.getKingdom().getReactors().filter((reactor) => {
      return !reactor.isIdle();
    }).map((reactor) => {
      return reactor.getOutput();
    });
    this.availableReactions = this.getReactions();

    setupTrace.end();
  }
  update() {
    this.availableReactions.forEach((reaction) => {
      const priority = PRIORITIES.REACTION_PRIORITIES[reaction['output']];
      const details = {
        [MEMORY.REACTOR_TASK_TYPE]: TASKS.REACTION,
        [MEMORY.REACTOR_INPUT_A]: reaction['inputA'],
        [MEMORY.REACTOR_INPUT_B]: reaction['inputB'],
        [MEMORY.REACTOR_OUTPUT]: reaction['output'],
        [MEMORY.REACTOR_AMOUNT]: REACTION_BATCH_SIZE,
      };
      this.getKingdom().sendRequest(TOPICS.TASK_REACTION, priority, details);
    });

    const colonies = this.getKingdom().getColonies();
    colonies.forEach((colony) => {
      const resources = colony.getReserveResources();

      Object.keys(resources).forEach((resource) => {
        if (resource === RESOURCE_ENERGY) {
          return;
        }

        if (resources[resource] > RESERVE_LIMIT) {
          const details = {
            [MEMORY.TERMINAL_TASK_TYPE]: TASKS.TASK_MARKET_ORDER,
            [MEMORY.MEMORY_ORDER_TYPE]: ORDER_SELL,
            [MEMORY.MEMORY_ORDER_RESOURCE]: resource,
            [MEMORY.MEMORY_ORDER_AMOUNT]: resources[resource] - RESERVE_LIMIT,
          };

          colony.sendRequest(TOPICS.TOPIC_TERMINAL_TASK, PRIORITIES.TERMINAL_SELL,
            details);
        }
      });
    });

    console.log(this);
  }
  process() {
    this.updateStats();
  }
  toString() {
    const reactions = this.availableReactions.map((reaction) => {
return reaction.output;
});

    return `** Resource Gov - Resources: ${JSON.stringify(this.resources)}, ` +
      `NextReactions: ${reactions.join(' ')}, CurrentReactions: ${this.activeReactions}`;
  }
  updateStats() {
    const stats = this.getStats();
    stats.resources = this.resource;
  }
  getReactions() {
    let availableReactions = {};
    let missingOneInput = {};
    const firstInputs = Object.keys(REACTIONS);
    firstInputs.forEach((inputA) => {
      // If we don't have a full batch, move onto next
      if (!this.resources[inputA] || this.resources[inputA] < REACTION_BATCH_SIZE) {
        return;
      }

      const secondInputs = Object.keys(REACTIONS[inputA]);
      secondInputs.forEach((inputB) => {
        const output = REACTIONS[inputA][inputB];

        if (this.activeReactions.indexOf(output) !== -1) {
          return;
        }

        // Check if we need more of the output
        if (this.resources[output] > RESERVE_LIMIT) {
          return;
        }

        // If we don't have a full batch if input mark missing one and go to next
        if (!this.resources[inputB] || this.resources[inputB] < REACTION_BATCH_SIZE) {
          if (!missingOneInput[output]) {
            missingOneInput[output] = {inputA, inputB, output};
          }
          return;
        }

        if (!availableReactions[output]) {
          availableReactions[output] = {inputA, inputB, output};
        }
      });
    });

    missingOneInput = this.prioritizeReactions(missingOneInput);
    availableReactions = this.prioritizeReactions(availableReactions);

    if (missingOneInput.length && Game.market.credits > 40000) {
      availableReactions.push(missingOneInput.pop());
    }

    return availableReactions;
  }
  prioritizeReactions(reactions) {
    return _.sortBy(Object.values(reactions), (reaction) => {
      let priority = PRIORITIES.REACTION_PRIORITIES[reaction['output']];
      if (this.resources[reaction['output']] >= RESERVE_LIMIT) {
        priority = priority - 3;
      }

      return priority;
    });
  }
}

module.exports = Resources;
