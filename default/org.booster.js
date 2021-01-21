const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');

class Booster extends OrgBase {
  constructor(parent, labs) {
    super(parent, labs[0].id)

    this.labs = labs
  }
  update() {
    console.log(this);
  }
  process() {

  }
  toString() {
    return `---- Booster: Id: ${this.labs[0].id}`;
  }
}

module.exports = Booster
