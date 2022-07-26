import {AI} from './ai';
import {ShardMap} from './config';
import * as metrics from './lib.metrics';
import {Tracer} from './lib.tracing';
import {Scheduler} from './os.scheduler';

const version = '__GIT_SHA__';

const friends = [];
const neutral = [];
const avoid = [];
const kos = [];

const shards: ShardMap = {
  'default': {
    buffer: 3,
    friends: friends,
    neutral: neutral,
    avoid: avoid,
    kos: kos,
    authorizedSieges: [],
    maxColonies: 10,
    autoExpand: true,
    autoAttack: true,
    explorers: true,
  },
  'shard2': {
    buffer: 3,
    friends: friends,
    neutral: neutral,
    avoid: avoid,
    kos: kos,
    authorizedSieges: [],
    maxColonies: 11,
    autoExpand: true,
    autoAttack: true,
    explorers: true,
  },
  'shard3': {
    buffer: 3,
    friends: friends,
    neutral: neutral,
    avoid: avoid,
    kos: kos,
    authorizedSieges: [],
    maxColonies: 7,
    autoExpand: false,
    autoAttack: true,
    explorers: false,
  },
};

const DEFAULT_LOG_WHEN_PID = null;
const DEFAULT_METRIC_REPORT = false;
const DEFAULT_METRIC_CONSOLE = false;
const DEFAULT_METRIC_FILTER = null;
const DEFAULT_METRIC_MIN = 0.1;
const DEFAULT_CPU_THROTTLE = 300;
const DEFAULT_SLOW_PROCESS = 10;

// On start copy memory values to debugging control flags
global.LOG_WHEN_PID = (Memory as any).LOG_WHEN_PID || DEFAULT_LOG_WHEN_PID;
global.METRIC_REPORT = (Memory as any).METRIC_REPORT || DEFAULT_METRIC_REPORT;
global.METRIC_CONSOLE = (Memory as any).METRIC_CONSOLE || DEFAULT_METRIC_CONSOLE;
global.METRIC_FILTER = (Memory as any).METRIC_FILTER || DEFAULT_METRIC_FILTER;
global.METRIC_MIN = (Memory as any).METRIC_MIN || DEFAULT_METRIC_MIN;
global.CPU_THROTTLE = (Memory as any).CPU_THROTTLE || DEFAULT_CPU_THROTTLE;
global.SLOW_PROCESS = (Memory as any).SLOW_PROCESS || DEFAULT_SLOW_PROCESS;

// Memory hack variables
let lastMemoryTick = 0;
let lastMemory: Memory = null;

// AI CPU usage tracking
let previousTick = 0; // Track previous tick time for display
let previousBucket = 0;
const previousSkipped = 0;

console.log('***** STARTING AI *****');

const bootTick = Game.time;

const shardName = Game.shard.name;
let shardConfig = shards[shardName];
if (!shardConfig) {
  console.log('no shard config found for shard', shardName);
  shardConfig = shards.default;
}

console.log('selected shard config', JSON.stringify(shardConfig));

const scheduler = new Scheduler();
scheduler.setCPUThrottle(global.CPU_THROTTLE);
scheduler.setSlowProcessThreshold(global.SLOW_PROCESS);

const trace = new Tracer('tick', new Map([['shard', Game.shard.name]]), 0);

const ai: AI = new AI(shardConfig, scheduler, trace);
global.AI = ai; // So we can access it from the console

export const loop = function () {
  const trace = new Tracer('tick', new Map([['shard', Game.shard.name]]), 0);

  // Set process id filter
  trace.setLogFilter(global.LOG_WHEN_PID);

  const end = trace.startTimer('memory_hack');
  // memory hack from Dissi
  if (lastMemoryTick && lastMemory && Game.time === (lastMemoryTick + 1)) {
    delete global.Memory;
    global.Memory = lastMemory;
    (RawMemory as any)._parsed = lastMemory;
  } else {
    Memory;
    lastMemory = (RawMemory as any)._parsed;
  }
  lastMemoryTick = Game.time;
  end();

  // Update memory for debugging controls control flags
  (Memory as any).LOG_WHEN_PID = global.LOG_WHEN_PID || DEFAULT_LOG_WHEN_PID;
  (Memory as any).METRIC_REPORT = global.METRIC_REPORT || DEFAULT_METRIC_REPORT;
  (Memory as any).METRIC_CONSOLE = global.METRIC_CONSOLE || DEFAULT_METRIC_CONSOLE;
  (Memory as any).METRIC_FILTER = global.METRIC_FILTER || DEFAULT_METRIC_FILTER;
  (Memory as any).METRIC_MIN = global.METRIC_MIN || DEFAULT_METRIC_MIN;
  (Memory as any).CPU_THROTTLE = global.CPU_THROTTLE || DEFAULT_CPU_THROTTLE;
  (Memory as any).SLOW_PROCESS = global.SLOW_PROCESS || DEFAULT_SLOW_PROCESS;

  // Enable metric collection
  if (global.METRIC_REPORT === true || global.METRIC_CONSOLE) {
    trace.setCollectMetrics(true);
  }

  // Filter metrics by name
  if (global.METRIC_FILTER) {
    trace.setMetricFilter(global.METRIC_FILTER);
  }

  // Filter metrics by minimum value
  if (global.METRIC_MIN >= 0) {
    trace.setMetricMin(global.METRIC_MIN);
  }

  scheduler.setCPUThrottle(global.CPU_THROTTLE);
  scheduler.setSlowProcessThreshold(global.SLOW_PROCESS);

  const tickSinceStart = Game.time - bootTick;

  console.log('======== TICK', Game.time, Game.shard.name, '==== prev cpu:',
    previousTick, previousSkipped, Game.cpu.bucket, tickSinceStart);

  // Tick the AI
  ai.tick(trace);

  // Output metrics to console that match the filter
  if (global.METRIC_CONSOLE) {
    trace.outputMetrics();
  }

  // Output metric aggregations to console
  if (global.METRIC_REPORT === true) {
    metrics.add(trace);
    metrics.setActive();
    metrics.reportMetrics();
  } else {
    metrics.setInactive();
  }

  // Get CPU spent on AI
  previousTick = Game.cpu.getUsed();
  previousBucket = Game.cpu.bucket;

  // Collect CPU stats
  if (Game.time % 5 === 0) {
    (Memory as any).stats.cpu = {};
    (Memory as any).stats.cpu.bucket = Game.cpu.bucket;
    (Memory as any).stats.cpu.limit = Game.cpu.limit;
    (Memory as any).stats.cpu.used = previousTick;
  }
};
