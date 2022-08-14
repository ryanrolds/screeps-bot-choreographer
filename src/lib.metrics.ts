import {Tracer} from "./lib.tracing";

export interface Metric {
  key: string;
  value: number;
  type: string;
  labels: Record<string, string>;
  created: number;
  updated: number;
}

export class Metrics {
  private defaultLabels: Record<string, string> = {};
  private metricsMap: Record<string, Metric> = {};

  constructor(labels: Record<string, string> = {}) {
    this.defaultLabels = labels;
  }

  private getKey(key: string, labels: Record<string, string> = {}): string {
    return `${key}_${Object.values(labels).sort().join(',')}`;
  }

  gauge(key: string, value: number, labels: Record<string, string> = {}) {
    this.metricsMap[this.getKey(key, labels)] = {
      key,
      value,
      type: 'gauge',
      labels: Object.assign(labels, this.defaultLabels),
      created: Game.time,
      updated: Game.time,
    };
  }

  counter(key: string, amount: number, labels: Record<string, string> = {}) {
    let metric = this.metricsMap[this.getKey(key, labels)];
    if (!metric) {
      metric = {
        key,
        value: 0,
        type: 'counter',
        labels: Object.assign({}, labels, this.defaultLabels),
        created: Game.time,
        updated: Game.time,
      };
    }

    metric.value += amount;
    metric.updated = Game.time;
    this.metricsMap[this.getKey(key, labels)] = metric;
  }

  histogram(_key: string, _value: number, _labels_: Record<string, string> = {}) {

  }

  summary(_key: string, _value: number, _labels: Record<string, string> = {}) {

  }

  // write the metrics to Memory
  write() {
    (Memory as any).metrics = Object.values(this.metricsMap);
  }
}

// ==========================================================================
// Below is for reporting tracer timings to the console

interface MetricRollup {
  key: string;
  total: number;
  count: number;
  max: number;
}

let accMetricsActive = false;
let accMetrics: Metric[] = [];

export const setActive = () => {
  accMetricsActive = true;
};

export const setInactive = () => {
  accMetricsActive = false;
  reset();
};

export const addTraceMetrics = (trace: Tracer) => {
  accMetrics = accMetrics.concat(trace.getMetrics());
};

const reset = () => {
  accMetrics = [];
};

export const reportMetrics = () => {
  if (!accMetricsActive) {
    return;
  }

  const summary = _.reduce(accMetrics, (acc, timing) => {
    const rollup = acc.get(timing.key) || {
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

    acc.set(timing.key, rollup);
    return acc;
  }, new Map<string, MetricRollup>());

  const rollups = Array.from(summary.values());
  let summaryArray = _.reduce(rollups, (result, metric) => {
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
  summaryArray.reverse().slice(0, 75).forEach((metric) => {
    console.log(`* ${(metric.total / metric.count).toFixed(2)}, ${metric.count.toFixed(0)}, ` +
      `${metric.total.toFixed(2)}, ${metric.max.toFixed(2)} - ${metric.key}`);
  });
};
