const RUNNING = module.exports.RUNNING = 'running';
const SUCCESS = module.exports.SUCCESS = 'success';
const FAILURE = module.exports.FAILURE = 'failure';

module.exports.rootNode = (id, behavior) => {
  return function(actor, trace, kingdom) {
    const rootTrace = trace.begin(id);

    const result = behavior.tick(actor, rootTrace, kingdom);
    if (result == FAILURE) {
      console.log('ROOT FAILURE:', actor.room.name, actor.id, actor.name);
    }

    rootTrace.end();
  }
}

module.exports.selectorNode = (id, children) => {
  return {
    id,
    children,
    tickChildren: function(actor, trace, kingdom) {
      let i = getState(actor, this.id);
      for (; i < children.length; i++) {
        const child = children[i];
        const result = child.tick(actor, trace, kingdom);
        switch (result) {
          case RUNNING:
            setState(actor, this.id, i);
            return RUNNING;
          case FAILURE:
            continue;
          case SUCCESS:
            return SUCCESS;
        }
      }

      return FAILURE;
    },
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickChildren(actor, trace, kingdom);

      trace.log(actor.id, "result", result)

      trace.end();

      return result;
    },
  };
};

module.exports.sequenceNode = (id, children) => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function(actor, trace, kingdom) {
      let i = getState(actor, this.id);
      for (; i < children.length; i++) {
        const result = children[i].tick(actor, trace, kingdom);
        switch (result) {
          case RUNNING:
            setState(actor, this.id, i);
            return RUNNING;
          case FAILURE:
            return FAILURE;
          case SUCCESS:
            continue;
        }
      }

      return SUCCESS;
    },
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickChildren(actor, trace, kingdom);

      trace.log(actor.id, "result", result)

      trace.end();

      return result;
    },
  };
};

module.exports.sequenceAlwaysNode = (id, children) => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function(actor, trace, kingdom) {
      for (let i = 0; i < children.length; i++) {
        const result = children[i].tick(actor, trace, kingdom);
        switch (result) {
          case RUNNING:
            return RUNNING;
          case FAILURE:
            return FAILURE;
          case SUCCESS:
            continue;
        }
      }

      return SUCCESS;
    },
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickChildren(actor, trace, kingdom);

      trace.log(actor.id, "result", result)

      trace.end();

      return result;
    },
  };
};

module.exports.repeatUntilFailure = (id, node) => {
  return {
    id,
    node,
    tickNode: function(actor, trace, kingdom) {
      const result = this.node.tick(actor, trace, kingdom);
      if (result === FAILURE) {
        return FAILURE;
      }

      return RUNNING;
    },
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickNode(actor, trace, kingdom);

      trace.log(actor.id, "result", result)

      trace.end();

      return result;
    },
  };
};

module.exports.repeatUntilSuccess = (id, node) => {
  return {
    id,
    node,
    tickNode: function(actor, trace, kingdom) {
      const result = this.node.tick(actor, trace, kingdom);
      if (result === SUCCESS) {
        return SUCCESS;
      }

      return RUNNING;
    },
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickNode(actor, trace, kingdom);

      trace.log(actor.id, "result", result)

      trace.end();

      return result;
    },
  };
};

module.exports.repeatUntilConditionMet = (id, condition, node) => {
  return {
    id,
    node,
    condition,
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const conditionResult = this.condition(actor, trace, kingdom)
      if (!conditionResult) {
        const result = this.node.tick(actor, trace, kingdom);

        trace.log(actor.id, "result", result)

        trace.end();

        if (result === FAILURE) {
          return FAILURE;
        }

        return RUNNING;
      }

      return SUCCESS;
    }
  };
};

module.exports.leafNode = (id, behavior) => {
  return {
    id,
    behavior,
    tickNode: function(actor, trace, kingdom) {
      return this.behavior(actor, trace, kingdom);
    },
    tick: function(actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickNode(actor, trace, kingdom);

      trace.log(actor.id, "result", result)

      trace.end();

      return result;
    },
  };
};

function getState(actor, id) {
  let i = 0;

  if (actor.memory[id]) {
    i = actor.memory[id];
  }

  delete actor.memory[id];

  return i;
}

function setState(actor, id, value) {
  actor.memory[id] = value;
}
