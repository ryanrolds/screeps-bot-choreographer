import * as _ from "lodash"

const globalAny: any = global;
globalAny.LOG_WHEN_ID = null;
globalAny.TRACING_FILTER = null;

interface Metric {
  key: string;
  value: number;
}

interface MetricRollup {
  key: string;
  total: number;
  count: number;
  max: number;
}

let isActive: boolean = false;
let metrics: Metric[] = [];

export class Tracer {
  id: string;
  name: string;
  start: number;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.start = Game.cpu.getUsed();
  }

  asId(id: string) {
    return startTrace(id, this.name);
  }

  with(name: string) {
    return startTrace(this.id, `${this.name}.${name}`);
  }

  log(message: string, details: Object = {}): void {
    if (this.id !== globalAny.LOG_WHEN_ID) {
      return;
    }

    console.log(this.id, this.name, message, JSON.stringify(details));
  }

  error(message: string, details: Object = {}): void {
    console.log(`ERROR`, this.id, this.name, message, JSON.stringify(details));
  }

  begin(name: string) {
    const trace = startTrace(this.id, `${this.name}.${name}`);
    trace.start = Game.cpu.getUsed();
    return trace;
  }

  end() {
    if (!isActive) {
      return;
    }

    const end = Game.cpu.getUsed();
    const cpuTime = end - this.start;
    metrics.push({key: this.name, value: cpuTime});
  }
}

export const reset = () => {
  metrics = [];
};

export const setActive = () => {
  isActive = true;
};

export const setInactive = () => {
  isActive = false;
  reset();
};

export const startTrace = (id: string, name: string): Tracer => {
  return new Tracer(id, name);
};

export const report = () => {
  if (!isActive) {
    return;
  }

  let summary = _.reduce(metrics, (acc, timing) => {
    const rollup = acc[timing.key] || {
      key: timing.key,
      total: 0,
      count: 0,
      max: 0,
    };

    rollup.count++;
    rollup.total += timing.value;
    if (timing.value > rollup.max) {
      rollup.max = timing.value;
    }

    acc[timing.key] = rollup;
    return acc;
  }, {} as Record<string, MetricRollup>);

  let summaryArray = _.reduce(summary, (result, metric) => {
    result.push(metric);
    return result;
  }, []);

  summaryArray = _.sortBy(summaryArray, (metric) => {
    // return metric.total;
    return metric.total / metric.count;
  });

  console.log('------- CPU Usage report --------');

  // slice to 50 so that we don't overflow the console in the game
  summaryArray.reverse().slice(0, 75).forEach((metric) => {
    if (globalAny.TRACING_FILTER && !metric.key.startsWith(globalAny.TRACING_FILTER)) {
      return;
    }

    console.log(`* ${(metric.total / metric.count).toFixed(2)}, ${metric.count.toFixed(0)}, ` +
      `${metric.total.toFixed(2)}, ${metric.max.toFixed(2)} - ${metric.key}`);
  });
};
