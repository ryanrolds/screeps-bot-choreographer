const OrgBase = require('org.base');
const TOPICS = require('constants.topics');
const MEMORY = require('constants.memory');
const TASKS = require('constants.tasks');
const PRIORITIES = require('constants.priorities');

const RESERVE_LIMIT = 10000;

class Resources extends OrgBase {
  constructor(parent) {
    super(parent, 'resources');
  }
  update() {
    console.log(this);

    const colonies = this.getKingdom().getColonies();

    colonies.forEach((colony) => {
      const resources = colony.getReserveResources();

      Object.keys(resources).forEach((resource) => {
        if (resource === RESOURCE_ENERGY) {
          return;
        }

        console.log(colony.id, resource);

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
  }
  process() {

  }
  toString() {
    return `-- Resources`;
  }
  updateStats() {
    const stats = this.getStats();
    stats.resources = this.parent.getReserveResources();
  }
}

module.exports = Resources;
