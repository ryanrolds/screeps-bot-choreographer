import * as featureFlags from './lib.feature_flags';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import {running} from './os.process';

export const RUNNING = 'running';
export const SUCCESS = 'success';
export const FAILURE = 'failure';
export type NodeTickResult = 'running' | 'success' | 'failure';

export interface TickFunc {
  (creep: Creep, trace: Tracer, kingdom: Kingdom): NodeTickResult;
}

export interface TreeNode {
  id: string;
  tick: TickFunc;
  children?: TreeNode[];
  clear(creep: Creep, trace: Tracer);
}

export const rootNode = (id: string, behavior: TreeNode) => {
  return function (creep: Creep, trace: Tracer, kingdom: Kingdom): void {
    const rootTrace = trace.begin(id);

    const result = behavior.tick(creep, rootTrace, kingdom);
    trace.log('root result', {id});

    if (result === FAILURE) {
      trace.log('root failure', {id});
    }

    rootTrace.end();
  };
};

export const selectorNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id,
    children,
    tickChildren: function (creep, trace, kingdom) {
      let i = getState(creep, this.id, trace);
      setState(creep, this.id, 0, trace);

      for (; i < this.children.length; i++) {
        const result = this.children[i].tick(creep, trace, kingdom);
        trace.log('result', {result});
        switch (result) {
          case RUNNING:
            setState(creep, this.id, i, trace);
            return RUNNING;
          case FAILURE:
            continue;
          case SUCCESS:
            return SUCCESS;
        }
      }

      return FAILURE;
    },
    tick: function (creep, trace, kingdom): NodeTickResult {
      trace = trace.begin(this.id);
      trace.log('tick', {id: this.id});
      const result = this.tickChildren(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.children.forEach((child) => {
        child.clear(creep, trace);
      });
    },
  } as TreeNode;
};

export const sequenceNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function (creep, trace, kingdom) {
      let i = getState(creep, this.id, trace);
      for (; i < this.children.length; i++) {
        const result = this.children[i].tick(creep, trace, kingdom);
        switch (result) {
          case RUNNING:
            setState(creep, this.id, i, trace);
            return RUNNING;
          case FAILURE:
            return FAILURE;
          case SUCCESS:
            continue;
        }
      }

      return SUCCESS;
    },
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.tickChildren(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.children.forEach((child) => {
        child.clear(creep, trace);
      });
    },
  } as TreeNode;
};

export const alwaysNode = (id: string, node: TreeNode): TreeNode => {
  return {
    id, // used track state in memory
    node,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.node.tick(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
}

export const sequenceAlwaysNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function (creep, trace, kingdom) {
      for (let i = 0; i < this.children.length; i++) {
        const result = this.children[i].tick(creep, trace, kingdom);
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
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.tickChildren(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.children.forEach((child) => {
        child.clear(creep, trace);
      });
    },
  } as TreeNode;
};

export const repeatUntilFailure = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.node.tick(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();

      if (result === FAILURE) {
        return FAILURE;
      }

      return RUNNING;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
};

export const repeatUntilSuccess = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.node.tick(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();

      if (result === SUCCESS) {
        return SUCCESS;
      }

      return RUNNING;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
};

interface ConditionFunc {
  (creep: Creep, trace: Tracer, kingdom: Kingdom): boolean
}

export const repeatUntilConditionMet = (id: string, condition: ConditionFunc,
  node: TreeNode): TreeNode => {
  return {
    id,
    node,
    condition,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);

      trace.log('checking condition', {id: this.id});

      const conditionResult = this.condition(creep, trace, kingdom);
      if (!conditionResult) {
        trace.log('condition not met', {id: this.id});
        const result = this.node.tick(creep, trace, kingdom);
        trace.log('result', {result});
        trace.end();

        if (result === FAILURE) {
          return FAILURE;
        }

        return RUNNING;
      }

      // We made it through the condition, clear that branches state so that
      // next time around we start from scratch
      this.clear(creep, trace);

      trace.log('condition met', {id: this.id});
      trace.end();

      return SUCCESS;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
};

export const tripIfCalledXTimes = (id: string, limit: number, regular: TreeNode, tripped: TreeNode): TreeNode => {
  return {
    id,
    limit,
    regular,
    tripped,
    tick: function (creep, trace, kingdom): NodeTickResult {
      let i = getState(creep, this.id, trace);
      setState(creep, this.id, i + 1, trace);

      trace.log("trip", {i, limit: this.limit});

      if (i > this.limit) {
        trace.log("tripped")
        return this.tripped.tick(creep, trace, kingdom);
      }

      return this.regular.tick(creep, trace, kingdom);
    },
    clear: function (creep, trace): void {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
}

export const invert = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);

      let result = this.node.tick(creep, trace, kingdom);
      trace.log('result', result);

      if (result === FAILURE) {
        result = SUCCESS;
      } else if (result === SUCCESS) {
        result = FAILURE;
      }

      trace.log('inserted result', result);
      trace.end();

      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
};

export const returnSuccess = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.node.tick(creep, trace, kingdom);
      trace.log('result', result);

      trace.end();

      return SUCCESS;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.node.clear(creep, trace);
    },
  } as TreeNode;
};

export const leafNode = (id: string, behavior: TickFunc): TreeNode => {
  return {
    id,
    behavior,
    tick: function (creep, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.behavior(creep, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
    },
  } as TreeNode;
};

export const featureFlagBool = (id: string, flag: string, defaultNode: TreeNode,
  enabledNode: TreeNode): TreeNode => {
  return {
    id,
    flag,
    defaultNode,
    enabledNode,
    tick: function (creep: Creep, trace: Tracer, kingdom: Kingdom) {
      trace = trace.begin(this.id);

      let result = null;
      if (featureFlags.getFlag(this.flag)) {
        result = this.enabledNode.tick(creep, trace, kingdom);
      } else {
        result = this.defaultNode.tick(creep, trace, kingdom);
      }

      trace.log('result', result);
      trace.end();

      return result;
    },
    clear: function (creep, trace) {
      clearState(creep, this.id, trace);
      this.defaultNode.clear(creep, trace);
      this.enabledNode.clear(creep, trace);
    },
  } as TreeNode;
};

function getState(creep: Creep, id: string, trace: Tracer): number {
  let state = 0;

  if (creep.memory[id]) {
    state = creep.memory[id];
  }

  // Avoids state getting stuck on previous value, next
  // time we enter the node it will be 0 unless override it
  clearState(creep, id, trace);

  // trace.log('get state (clears existing state)', {id, state});
  return state;
}

function setState(creep: Creep, id: string, state: any, trace: Tracer): void {
  creep.memory[id] = state;
  // trace.log('set state', {id, state});
}

function clearState(creep: Creep, id: string, trace: Tracer): void {
  // trace.log('clear state', {id, state: creep.memory[id]});
  delete creep.memory[id];
}
