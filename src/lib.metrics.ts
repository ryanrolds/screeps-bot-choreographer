import {Metric, Tracer} from './lib.tracing';

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

export const add = (trace: Tracer) => {
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
  }, {} as Map<string, MetricRollup>);

  const rollups = _.values<MetricRollup>(summary);
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
