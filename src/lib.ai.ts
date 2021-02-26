import Kingdom from './org.kingdom';
import * as tracing from './lib.tracing';
import {KingdomConfig} from './config'
import {Tracer} from './lib.tracing';

export class AI {
  config: KingdomConfig;
  kingdom: Kingdom;

  constructor(config: KingdomConfig) {
    const trace = tracing.startTrace('ai_constructor');

    this.config = config;
    this.kingdom = new Kingdom(config, trace);

    trace.end();
  }

  tick(trace: Tracer) {
    trace = trace.begin('tick');

    this.kingdom.update(trace);
    this.kingdom.process(trace);

    trace.end();
  }
  getKingdom(): Kingdom {
    return this.kingdom;
  }
}
