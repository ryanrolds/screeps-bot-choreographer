import * as featureFlags from './lib.feature_flags';
import {Actor} from './actor';
import {Tracer} from './lib.tracing';
import Kingdom from './org.kingdom';

export const RUNNING = 'running';
export const SUCCESS = 'success';
export const FAILURE = 'failure';
export type NodeTickResult = 'running' | 'success' | 'failure';

interface TickFunc {
  (actor: Actor, trace: Tracer, kingdom: Kingdom): NodeTickResult;
}

interface TreeNode {
  id: string;
  tick: TickFunc
}

export const rootNode = (id: string, behavior: TreeNode) => {
  return function (actor: Actor, trace: Tracer, kingdom: Kingdom): void {
    const rootTrace = trace.begin(id);

    const result = behavior.tick(actor, rootTrace, kingdom);
    if (result == FAILURE) {
      // console.log('ROOT FAILURE:', actor.room.name, actor.id, actor.name);
    }

    rootTrace.end();
  };
};

export const selectorNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id,
    children,
    tickChildren: function (actor, trace, kingdom) {
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
    tick: function (actor, trace, kingdom): NodeTickResult {
      trace = trace.begin(this.id);

      const result = this.tickChildren(actor, trace, kingdom);

      trace.log('result', result);

      trace.end();

      return result;
    },
  } as TreeNode;
};

export const sequenceNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function (actor, trace, kingdom) {
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
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickChildren(actor, trace, kingdom);

      trace.log('result', result);

      trace.end();

      return result;
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
  } as TreeNode;
}

export const sequenceAlwaysNode = (id: string, children: TreeNode[]): TreeNode => {
  return {
    id, // used track state in memory
    children,
    tickChildren: function (actor, trace, kingdom) {
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
    tick: function (actor, trace, kingdom) {
      trace = trace.begin(this.id);

      const result = this.tickChildren(actor, trace, kingdom);

      trace.log('result', result);

      trace.end();

      return result;
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

      const conditionResult = this.condition(actor, trace, kingdom);
      if (!conditionResult) {
        const result = this.node.tick(actor, trace, kingdom);

        trace.log('result', result);

        trace.end();

        if (result === FAILURE) {
          return FAILURE;
        }

        return RUNNING;
      }

      return SUCCESS;
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

      if (result === FAILURE) {
        result = SUCCESS;
      } else if (result === SUCCESS) {
        result = FAILURE;
      }

      trace.log('result', result);

      trace.end();

      return result;
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
  } as TreeNode;
};

export const featureFlagBool = (id: string, flag: string, defaultBehavior: TreeNode,
  enabledBehavior: TreeNode): TreeNode => {
  return {
    id,
    flag,
    defaultBehavior,
    enabledBehavior,
    tick: function (actor: Actor, trace: Tracer, kingdom: Kingdom) {
      trace = trace.begin(this.id);

      let result = null;
      if (featureFlags.getFlag(this.flag)) {
        result = this.enabledBehavior.tick(actor, trace, kingdom);
      } else {
        result = this.defaultBehavior.tick(actor, trace, kingdom);
      }

      trace.log('result', result);

      trace.end();

      return result;
    },
  } as TreeNode;
};

function getState(actor: Actor, id: string): number {
  let i = 0;

  if (actor.memory[id]) {
    i = actor.memory[id];
  }

  delete actor.memory[id];

  return i;
}

function setState(actor: Actor, id: string, value: any): void {
  actor.memory[id] = value;
}
