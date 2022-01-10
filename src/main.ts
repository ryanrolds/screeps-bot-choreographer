import * as tracing from './lib.tracing';
import {Tracer} from './lib.tracing';
import {AI} from './lib.ai';
import {KingdomConfig} from './config'

let config: KingdomConfig = {
  'buffer': 3,
  'friends': [
    'PythonBeatJava',
    'ChaosDMG',
  ],
  'neutral': [
    'JavaXCrow',
    'likeafox',
    'kobez0r',
  ],
  'avoid': [],
  'kos': [],
  'maxColonies': 8, // TODO make this specific to the shard - this will bite me in the ass
  'shards': {
    'shard0': {},
    'shard1': {},
    'shard2': {
      'E21S48-Shard2': {
        id: 'E21S48-Shard2',
        primary: 'E21S48',
        isPublic: false,
        rooms: ['E21S48'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E22S48-Shard2': {
        id: 'E22S48-Shard2',
        primary: 'E22S48',
        isPublic: false,
        rooms: ['E22S48', 'E22S47', 'E22S46'/*, 'E21S46'*/],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E22S49-Shard2': {
        id: 'E22S49-Shard2',
        primary: 'E22S49',
        isPublic: false,
        rooms: ['E22S49'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E23S45-Shard2': {
        id: 'E23S45-Shard2',
        primary: 'E23S45',
        isPublic: false,
        rooms: ['E23S45', 'E23S44', 'E22S44', 'E23S43', 'E23S46'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E22S45-Shard2': {
        id: 'E22S45-Shard2',
        primary: 'E22S45',
        isPublic: false,
        rooms: ['E22S45'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      }/*,
      'E23S47-Shard2': {
        id: 'E23S47-Shard2',
        primary: 'E23S47',
        isPublic: false,
        rooms: ['E23S47'],
        walls: [],
      },
      'E21S46-Shard2': {
        id: 'E21S46-Shard2',
        primary: 'E21S46',
        isPublic: false,
        rooms: ['E21S46'],
        walls: [],
      }'E17S51-Shard2': {
        id: 'E17S51-Shard2',
        primary: 'E17S51',
        isPublic: false,
        rooms: ['E17S51', 'E16S51', 'E18S51'],
        walls: [],
      },*/
    },
    'shard3': {
      'E18S48-Shard3': {
        id: 'E18S48-Shard3',
        primary: 'E18S48',
        isPublic: false,
        rooms: ['E18S48'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E18S47-Shard3': {
        id: 'E18S47-Shard3',
        primary: 'E18S47',
        isPublic: false,
        rooms: ['E18S47'],
        // rooms: ['E18S47', 'E19S46'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E18S45-Shard3': {
        id: 'E18S45-Shard3',
        primary: 'E18S45',
        isPublic: false,
        rooms: ['E18S45'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E17S49-Shard3': {
        id: 'E17S49-Shard3',
        primary: 'E17S49',
        isPublic: false,
        rooms: ['E17S49'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E15S48-Shard3': {
        id: 'E15S48-Shard3',
        primary: 'E15S48',
        isPublic: false,
        rooms: ['E15S48'],
        // rooms: ['E15S48', 'E16S48', 'E14S48'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E12S49-Shard3': {
        id: 'E12S49-Shard3',
        primary: 'E12S49',
        isPublic: false,
        rooms: ['E12S49'],
        //rooms: ['E12S49', 'E13S49'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E19S51-Shard3': {
        id: 'E19S51-Shard3',
        primary: 'E19S51',
        isPublic: false,
        rooms: ['E19S51'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
      'E13S49-Shard3': {
        id: 'E13S49-Shard3',
        primary: 'E13S49',
        isPublic: false,
        rooms: ['E13S49'],
        automated: false,
        origin: null,
        parking: null,
        walls: [],
      },
    },
  },
};


let ai: AI = null
global.AI = null; // So we can access it from the console
let previousTick = 0; // Track previous tick time for display
let previousBucket = 0;

global.TRACING_ACTIVE = false;

export const loop = function () {
  const fields = {shard: Game.shard.name};
  const trace = new Tracer('tick', fields, 0);

  if (global.TRACING_ACTIVE === true) {
    tracing.setActive();
  } else {
    tracing.setInactive();
  }

  console.log('======== TICK', Game.time, Game.shard.name, '==== prev cpu:', previousTick, previousBucket);

  if (!ai) {
    console.log('***** STARTING AI *****');
    ai = new AI(config, trace);
    global.AI = ai;
  }

  ai.tick(trace);

  if (global.METRIC_FILTER) {
    trace.outputMetrics();
  }

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
