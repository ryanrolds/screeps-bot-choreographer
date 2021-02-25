const Kingdom = require('./org.kingdom');
const tracing = require('./lib.tracing');

class AI {
  constructor(config) {
    const trace = tracing.startTrace('ai_constructor');

    this.config = config;

    this.kingdom = new Kingdom(config, trace);

    trace.end();
  }

  tick(trace) {
    trace = trace.begin('tick');

    this.kingdom.update(trace);
    this.kingdom.process(trace);

    trace.end();
  }
  getKingdom() {
    return this.kingdom;
  }
}

module.exports = {
  AI,
};
