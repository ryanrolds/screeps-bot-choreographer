import {clear} from 'node:console';
import * as featureFlags from './lib.feature_flags';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';

export const RUNNING = 'running';
export const SUCCESS = 'success';
export const FAILURE = 'failure';
export type NodeTickResult = 'running' | 'success' | 'failure';

interface TickFunc {
  (actor: Actor, trace: Tracer, kingdom: Kingdom): NodeTickResult;
}

interface TreeNode {
  id: string;
  tick: TickFunc;
  children?: TreeNode[];
  clear(actor: Actor, trace: Tracer);
}

interface Actor {
  id: string;
  memory: Object;
}

export const rootNode = (id: string, behavior: TreeNode) => {
  return function (actor: Actor, trace: Tracer, kingdom: Kingdom): void {
    const rootTrace = trace.begin(id);

    const result = behavior.tick(actor, rootTrace, kingdom);
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
    tickChildren: function (actor, trace, kingdom) {
      let i = getState(actor, this.id, trace);
      setState(actor, this.id, 0, trace);

      for (; i < this.children.length; i++) {
        const result = this.children[i].tick(actor, trace, kingdom);
        trace.log('result', {result});
        switch (result) {
          case RUNNING:
            setState(actor, this.id, i, trace);
            return RUNNING;
          case FAILURE:
            continue;
          case SUCCESS:
            return SUCCESS;
        }
      }

      return FAILURE;
    },
    tick: function (actor, trace, kingdom): NodeTickResult {
      trace = trace.begin(this.id);
      trace.log('tick', {id: this.id});
      const result = this.tickChildren(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.children.forEach((child) => {
        child.clear(actor, trace);
      });
    },
  } as TreeNode;
};

export const sequenceNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function (actor, trace, kingdom) {
      let i = getState(actor, this.id, trace);
      for (; i < this.children.length; i++) {
        const result = this.children[i].tick(actor, trace, kingdom);
        switch (result) {
          case RUNNING:
            setState(actor, this.id, i, trace);
            return RUNNING;
          case FAILURE:
            return FAILURE;
          case SUCCESS:
            continue;
        }
      }

      return SUCCESS;
    },
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.tickChildren(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.children.forEach((child) => {
        child.clear(actor, trace);
      });
    },
  } as TreeNode;
};

export const alwaysNode = (id: string, node: TreeNode): TreeNode => {
  return {
    id, // used track state in memory
    node,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.node.tick(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.node.clear(actor, trace);
    },
  } as TreeNode;
}

export const sequenceAlwaysNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function (actor, trace, kingdom) {
      for (let i = 0; i < this.children.length; i++) {
        const result = this.children[i].tick(actor, trace, kingdom);
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
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.tickChildren(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.children.forEach((child) => {
        child.clear(actor, trace);
      });
    },
  } as TreeNode;
};

export const repeatUntilFailure = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.node.tick(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();

      if (result === FAILURE) {
        return FAILURE;
      }

      return RUNNING;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.node.clear(actor, trace);
    },
  } as TreeNode;
};

export const repeatUntilSuccess = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.node.tick(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();

      if (result === SUCCESS) {
        return SUCCESS;
      }

      return RUNNING;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.node.clear(actor, trace);
    },
  } as TreeNode;
};

interface ConditionFunc {
  (actor: Actor, trace: Tracer, kingdom: Kingdom): boolean
}

export const repeatUntilConditionMet = (id: string, condition: ConditionFunc,
  node: TreeNode): TreeNode => {
  return {
    id,
    node,
    condition,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);

      trace.log('checking condition', {id: this.id});

      const conditionResult = this.condition(actor, trace, kingdom);
      if (!conditionResult) {
        trace.log('condition not met', {id: this.id});
        const result = this.node.tick(actor, trace, kingdom);
        trace.log('result', {result});
        trace.end();

        if (result === FAILURE) {
          return FAILURE;
        }

        return RUNNING;
      }

      // We made it through the condition, clear that branches state so that
      // next time around we start from scratch
      this.clear(actor, trace);

      trace.log('condition met', {id: this.id});
      trace.end();

      return SUCCESS;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.node.clear(actor, trace);
    },
  } as TreeNode;
};

export const invert = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);

      let result = this.node.tick(actor, trace, kingdom);
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
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.node.clear(actor, trace);
    },
  } as TreeNode;
};

export const returnSuccess = (id: string, node: TreeNode): TreeNode => {
  return {
    id,
    node,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.node.tick(actor, trace, kingdom);
      trace.log('result', result);

      trace.end();

      return SUCCESS;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.node.clear(actor, trace);
    },
  } as TreeNode;
};

export const leafNode = (id: string, behavior: TickFunc): TreeNode => {
  return {
    id,
    behavior,
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);
      const result = this.behavior(actor, trace, kingdom);
      trace.log('result', result);
      trace.end();
      return result;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
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
    tick: function (actor: Actor, trace: Tracer, kingdom: Kingdom) {
      trace = trace.begin(this.id);

      let result = null;
      if (featureFlags.getFlag(this.flag)) {
        result = this.enabledNode.tick(actor, trace, kingdom);
      } else {
        result = this.defaultNode.tick(actor, trace, kingdom);
      }

      trace.log('result', result);

      trace.end();

      return result;
    },
    clear: function (actor, trace) {
      clearState(actor, this.id, trace);
      this.defaultNode.clear(actor, trace);
      this.enabledNode.clear(actor, trace);
    },
  } as TreeNode;
};

function getState(actor: Actor, id: string, trace: Tracer): number {
  let state = 0;

  if (actor.memory[id]) {
    state = actor.memory[id];
  }

  // Avoids state getting stuck on previous value, next
  // time we enter the node it will be 0 unless override it
  clearState(actor, id, trace);

  trace.log('get state (clears existing state)', {id, state});
  return state;
}

function setState(actor: Actor, id: string, state: any, trace: Tracer): void {
  actor.memory[id] = state;
  trace.log('set state', {id, state});
}

function clearState(actor: Actor, id: string, trace: Tracer): void {
  trace.log('clear state', {id, state: actor.memory[id]});
  delete actor.memory[id];
}
