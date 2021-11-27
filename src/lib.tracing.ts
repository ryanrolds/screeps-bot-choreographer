import * as _ from "lodash"

const globalAny: any = global;
globalAny.LOG_WHEN_ID = null;
globalAny.TRACING_FILTER = null;

interface Metric {
  key: string;
  value: number;
  fields: TracerFields;
}

interface MetricRollup {
  key: string;
  total: number;
  count: number;
  max: number;
}

let isActive: boolean = false;
let metrics: Metric[] = [];

type TracerFields = Record<string, string>;
type TimerEndFunc = () => number;

export class Tracer {
  name: string;
  kv: TracerFields;
  start: number;

  constructor(name: string, kv: TracerFields, start: number) {
    this.name = name;
    this.kv = kv;
    this.start = 0;
  }

  as(name: string) {
    const trace = this.clone();
    trace.name = `${this.name}.${name}`;
    return trace;
  }

  withFields(fields: TracerFields): Tracer {
    let child = this.clone()
    //child.kv = _.assign({}, this.kv, fields)
    return child;
  }

  log(message: string, details: Object = {}): void {
    if (this.kv['id'] !== globalAny.LOG_WHEN_ID) {
      return;
    }

    console.log(this.name, message, JSON.stringify(details), JSON.stringify(this.kv));
  }

  notice(message: string, details: Object = {}): void {
    console.log(`[NOTICE]`, this.name, '::', message, JSON.stringify(details), JSON.stringify(this.kv));
  }

  error(message: string, details: Object = {}): void {
    console.log(`[ERROR]`, this.name, '::', message, JSON.stringify(details), JSON.stringify(this.kv));
  }

  startTimer(metric: string): TimerEndFunc {
    if (!isActive) {
      return () => null;
    }

    const start = Game.cpu.getUsed();
    return (): number => {
      // If tracing not active minimize the overhead of the tracer
      if (!isActive || !start) {
        return 0;
      }

      const end = Game.cpu.getUsed();
      const cpuTime = end - start;
      metrics.push({key: `${this.name}:${metric}`, value: cpuTime, fields: this.kv});

      return cpuTime;
    }
  }

  private clone() {
    return new Tracer(this.name, this.kv, this.start);
  }

  // deprecated (use startTimer)
  begin(name: string) {
    const trace = this.clone().as(name);
    trace.start = Game.cpu.getUsed();
    return trace;
  }

  // deprecated (use startTimer)
  end(): number {
    // If tracing not active minimize the overhead of the tracer
    if (!isActive && !this.start) {
      return 0;
    }

    const end = Game.cpu.getUsed();
    const cpuTime = end - this.start;
    metrics.push({key: this.name, value: cpuTime, fields: this.kv});

    return cpuTime;
  }
}

// TODO add profile class and replace Tracer.begin/end

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
    return metric.total;
    // return metric.total / metric.count;
  });

  console.log('------- CPU Usage report --------');

  console.log('= Time Avg, Count, Total time, Max Time');

  // slice to 75 so that we don't overflow the console in the game
  summaryArray.reverse().filter((metric) => {
    if (!globalAny.TRACING_FILTER) {
      return true;
    }

    if (metric.key.startsWith(globalAny.TRACING_FILTER)) {
      return true;
    }

    return false;
  }).slice(0, 75).forEach((metric) => {
    console.log(`* ${(metric.total / metric.count).toFixed(2)}, ${metric.count.toFixed(0)}, ` +
      `${metric.total.toFixed(2)}, ${metric.max.toFixed(2)} - ${metric.key}`);
  });
};
