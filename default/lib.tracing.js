let isActive = false;
let metrics = [];

global.LOG_WHEN_ID = null

const reset = () => {
  metrics = [];
};

const setActive = () => {
  isActive = true;
};

const setInactive = () => {
  isActive = false;
  reset();
}

const startTrace = (name) => {
  return {
    name,
    start: Game.cpu.getUsed(),
    with: function(name) {
      return startTrace(`${this.name}.${name}`);
    },
    begin: function(name) {
      const trace = startTrace(`${this.name}.${name}`);
      trace.start = Game.cpu.getUsed();
      return trace;
    },
    log: function(id, message, details) {
      if (id !== global.LOG_WHEN_ID) {
        return
      }

      console.log(id, this.name, message, details)
    },
    end: function() {
      if (!isActive) {
        return;
      }

      const end = Game.cpu.getUsed();
      const cpuTime = end - this.start;
      metrics.push({key: name, value: cpuTime});
    },
  };
};

const report = () => {
  if (!isActive) {
    return;
  }

  let summary = _.reduce(metrics, (acc, timing) => {
    const metric = acc[timing.key] || {
      key: timing.key,
      total: 0,
      count: 0,
    };

    metric.count++;
    metric.total += timing.value;

    acc[timing.key] = metric;
    return acc;
  }, {});

  summary = _.reduce(summary, (result, metric) => {
    result.push(metric);
    return result;
  }, []);

  summary = _.sortBy(summary, (metric) => {
    return metric.total / metric.count;
  });

  console.log('------- CPU Usage report --------');

  // slice to 50 so that we don't overflow the console in the game
  summary.reverse().slice(0, 75).forEach((metric) => {
    console.log(`* ${(metric.total / metric.count).toFixed(2)}, ${metric.count.toFixed(0)},` +
      ` ${metric.total.toFixed(2)} - ${metric.key}`);
  });
};

module.exports = {
  reset,
  setActive,
  setInactive,
  startTrace,
  report,
};
