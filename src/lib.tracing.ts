import {trace} from "console";
import * as _ from "lodash"

const globalAny: any = global;
globalAny.LOG_WHEN_ID = null;
globalAny.METRIC_FILTER = null;
globalAny.METRIC_MIN = 0.1;

interface Metric {
  start: number;
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
  children: Tracer[];
  metrics: Metric[];

  constructor(name: string, kv: TracerFields, start: number) {
    this.name = name;
    this.kv = kv;

    this.start = 0;
    this.children = [];
    this.metrics = [];
  }

  as(name: string) {
    const trace = this.clone();
    trace.name = `${this.name}.${name}`;
    return trace;
  }

  withFields(fields: TracerFields): Tracer {
    let child = this.clone()
    child.kv = _.assign(child.kv, fields)
    return child;
  }

  log(message: string, details: Object = {}): void {
    if (!this.shouldLog()) {
      return;
    }

    console.log(this.name, message, JSON.stringify(details), JSON.stringify(this.kv));
  }

  notice(message: string, details: Object = {}): void {
    console.log(`<font color="#5555FF">[NOTICE]`, this.name, '::', message, JSON.stringify(details),
      JSON.stringify(this.kv), '</font>');
  }

  error(message: string, details: Object = {}): void {
    console.log(`<font color="#FF5555">[ERROR]`, this.name, '::', message, JSON.stringify(details),
      JSON.stringify(this.kv), '</font>');
  }

  startTimer(metric: string): TimerEndFunc {
    // If tracing not active minimize the overhead of the tracer
    if (!this.shouldTrace() && !this.shouldLog()) {
      return () => 0
    }

    const start = Game.cpu.getUsed();
    return (): number => {
      const stop = Game.cpu.getUsed();
      const cpuTime = stop - start;

      const item = {start: start, key: `${this.name}.${metric}`, value: cpuTime, fields: this.kv}
      this.metrics.push(item);

      return cpuTime;
    }
  }

  outputMetrics() {
    _.sortBy(this.getMetrics(), 'start').forEach(metric => {
      if (metric.value > globalAny.METRIC_MIN) {
        console.log(`${metric.value.toFixed(2).padStart(5, ' ')}ms: ${metric.key} at ${metric.start}`,
          JSON.stringify(metric.fields));
      }
    });
  }

  private getMetrics(): Metric[] {
    let metrics = [].concat(this.metrics);

    this.children.forEach(child => {
      metrics = metrics.concat(child.getMetrics());
    });

    return metrics;
  }

  private clone() {
    const child = new Tracer(this.name, this.kv, this.start);
    child.kv = _.assign({}, this.kv)

    this.children.push(child);
    return child;
  }

  private shouldTrace(): boolean {
    return (globalAny.METRIC_FILTER && this.name.startsWith(globalAny.METRIC_FILTER)) ||
      (globalAny.TRACING_ACTIVE && this.name.startsWith(globalAny.TRACING_FILTER));
  }

  private shouldLog(): boolean {
    return globalAny.LOG_WHEN_ID === this.kv['pid']
  }

  /**
   * @deprecated The method is being replaced with startTimer
   */
  begin(name: string) {
    const trace = this.clone().as(name);
    trace.start = Game.cpu.getUsed();
    return trace;
  }

  /**
   * @deprecated  The method is being replaced with startTimer
   */
  end(): number {
    // If tracing not active minimize the overhead of the tracer
    if (!this.start || (!this.shouldTrace() && !this.shouldLog())) {
      return 0
    }

    const stop = Game.cpu.getUsed();
    const cpuTime = stop - this.start;

    const item = {start: this.start, key: this.name, value: cpuTime, fields: this.kv}
    this.metrics.push(item);

    if (this.shouldLog()) {
      console.log(`${cpuTime.toFixed(2).padStart(5, ' ')}ms: ${this.name} at ${this.start}`,
        JSON.stringify(this.kv));
    }

    return cpuTime;
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
