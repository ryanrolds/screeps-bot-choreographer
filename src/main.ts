import * as tracing from './lib.tracing';
import {AI} from './lib.ai';
import {KingdomConfig} from './config'

global.TRACING_ACTIVE = false;

let config: KingdomConfig = {
  'E18S48-Shard3': {
    id: 'E18S48-Shard3',
    primary: 'E18S48',
    rooms: ['E18S48'],
  },
  'E18S47-Shard3': {
    id: 'E18S47-Shard3',
    primary: 'E18S47',
    //rooms: ['E18S47'],
    rooms: ['E18S47', 'E19S46'],
  },
  'E18S45-Shard3': {
    id: 'E18S45-Shard3',
    primary: 'E18S45',
    rooms: ['E18S45'],
  },
  'E17S49-Shard3': {
    id: 'E17S49-Shard3',
    primary: 'E17S49',
    rooms: ['E17S49'],
  },
  'E15S48-Shard3': {
    id: 'E15S48-Shard3',
    primary: 'E15S48',
    rooms: ['E15S48'],
    //rooms: ['E15S48', 'E16S48', 'E14S48'],
  },
  'E12S49-Shard3': {
    id: 'E12S49-Shard3',
    primary: 'E12S49',
    //rooms: ['E12S49'],
    rooms: ['E12S49', 'E13S49'],
  },
};

if (Game.shard.name === 'shardSeason') {
  config = {
    'W22S21': {
      id: 'W22S21-Shard3',
      primary: 'W22S21',
      rooms: [
        'W22S21',
      ],
    },
  };
}

console.log('***** setting up ai *****');
const ai = new AI(config);
global.AI = ai; // So we can access it from the console

export const loop = function () {
  const trace = tracing.startTrace('loop');

  if (global.TRACING_ACTIVE === true) {
    tracing.setActive();
  } else {
    tracing.setInactive();
  }

  console.log('======== TICK', Game.time, '========');

  const aiTrace = trace.begin('ai');
  ai.tick(aiTrace);
  aiTrace.end();

  console.log('--------------------------------');

  trace.end();
  tracing.report();
};
