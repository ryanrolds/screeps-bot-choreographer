import * as _ from 'lodash';
import {Metric} from './lib.metrics';

export type TracerFields = Map<string, string>;
type TimerEndFunc = () => number;

export class Tracer {
  name: string;
  kv: TracerFields;

  start: number;
  children: Tracer[];

  logFilter: string;

  collect: boolean;
  collectFilter: string;
  collectMin: number;
  metrics: Metric[];

  constructor(name: string, kv: TracerFields) {
    this.name = name;
    this.kv = kv;

    this.start = 0;
    this.children = [];

    this.logFilter = null;

    this.collect = false;
    this.collectFilter = null;
    this.collectMin = 0.5;
    this.metrics = [];
  }

  as(name: string) {
    const trace = this.clone();
    trace.name = `${this.name}.${name}`;
    return trace;
  }

  withFields(fields: TracerFields): Tracer {
    const child = this.clone();
    for (const [key, value] of fields.entries()) {
      child.kv.set(key, value);
    }
    return child;
  }

  /**
   * @deprecated Use `info(...)` instead.
   */
  log(message: string, details: Record<string, unknown> = {}): void {
    this.info(message, details);
  }

  info(message: string, details: Record<string, unknown> = {}): void {
    if (!this.shouldLog()) {
      return;
    }

    console.log(`<font color="#3FBF7F">[INFO]`, this.name, '::', message, JSON.stringify(details),
      JSON.stringify(this.kv), '</font>');
  }

  notice(message: string, details: Record<string, unknown> = {}): void {
    console.log(`<font color="#2B7FD3">[NOTICE]`, this.name, '::', message, JSON.stringify(details),
      JSON.stringify(this.kv), '</font>');
  }

  warn(message: string, details: Record<string, unknown> = {}): void {
    console.log(`<font color="#ffbb00">[WARN]`, this.name, '::', message, JSON.stringify(details),
      JSON.stringify(this.kv), '</font>');
  }

  error(message: string, details: Record<string, unknown> = {}): void {
    console.log(`<font color="#FF5555">[ERROR]`, this.name, '::', message, JSON.stringify(details),
      JSON.stringify(this.kv), '</font>');
  }

  startTimer(metric: string): TimerEndFunc {
    const start = Game.cpu.getUsed();
    return (): number => {
      const stop = Game.cpu.getUsed();
      const cpuTime = stop - start;

      if (this.shouldCollectMetrics(cpuTime)) {
        this.pushMetric(cpuTime);
      }

      if (this.shouldLog()) {
        this.writeLog(metric, cpuTime);
      }

      return cpuTime;
    };
  }

  setLogFilter(filter: string) {
    this.logFilter = filter;
  }

  setCollectMetrics(active: boolean) {
    this.collect = active;
  }

  setMetricFilter(filter: string) {
    this.collectFilter = filter;
  }

  setMetricMin(min: number) {
    this.collectMin = min;
  }

  outputMetrics() {
    _.sortBy(this.getMetrics(), 'start').forEach((metric) => {
      console.log(`${metric.value.toFixed(2).padStart(5, ' ')}ms: ${metric.key} at ${metric.updated}`,
        JSON.stringify(metric.labels));
    });
  }

  getMetrics(): Metric[] {
    let metrics = [].concat(this.metrics);

    this.children.forEach((child) => {
      metrics = metrics.concat(child.getMetrics());
    });

    return metrics;
  }

  private clone() {
    const child = new Tracer(this.name, this.kv);
    child.kv = new Map(this.kv.entries());

    child.logFilter = this.logFilter;
    child.collect = this.collect;
    child.collectFilter = this.collectFilter;
    child.collectMin = this.collectMin;

    this.children.push(child);
    return child;
  }

  private shouldCollectMetrics(cpuTime: number): boolean {
    return this.collect && (!this.collectFilter || this.name.startsWith(this.collectFilter)) &&
      (!this.collectMin || (this.collectMin > 0 && this.collectMin < cpuTime));
  }

  private shouldLog(): boolean {
    return this.logFilter === this.kv.get('pid');
  }

  private pushMetric(cpuTime: number) {
    const labels = {};
    this.kv.forEach((value, key) => (labels[key] = value));
    const item = {
      key: this.name, type: 'gauge', value: cpuTime, labels: labels,
      created: Game.time, updated: Game.time
    };
    this.metrics.push(item);
  }

  private writeLog(metric: string, cpuTime: number) {
    console.log(`${cpuTime.toFixed(2).padStart(5, ' ')}ms: ${this.name} ${metric || ''} at ${this.start}`,
      JSON.stringify(this.kv));
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
    if (!this.start) {
      return 0;
    }

    const stop = Game.cpu.getUsed();
    const cpuTime = stop - this.start;

    if (this.shouldCollectMetrics(cpuTime)) {
      this.pushMetric(cpuTime);
    }

    if (this.shouldLog()) {
      this.writeLog(null, cpuTime);
    }

    return cpuTime;
  }
}
