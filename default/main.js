const tracing = require('./lib.tracing');
const AI = require('./lib.ai')
const Kingdom = require('./org.kingdom');

global.TRACING_ACTIVE = false;

let config = {
  'E18S48': {
    id: 'E18S48-Shard3',
    primary: 'E18S48',
    rooms: ['E18S48'],
  },
  'E18S47': {
    id: 'E18S47-Shard3',
    primary: 'E18S47',
    rooms: ['E18S47'],
  },
  'E18S45': {
    id: 'E18S45-Shard3',
    primary: 'E18S45',
    rooms: ['E18S45'],
  },
  'E17S49': {
    id: 'E17S49-Shard3',
    primary: 'E17S49',
    rooms: ['E17S49'],
  },
  'E15S48': {
    id: 'E15S48-Shard3',
    primary: 'E15S48',
    rooms: ['E15S48', 'E16S48', 'E14S48'],
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

const ai = new AI(config);

module.exports.loop = function() {
  const trace = tracing.startTrace('main');

  if (global.TRACING_ACTIVE === true) {
    tracing.setActive();
  } else {
    tracing.setInactive();
  }

  console.log('======== TICK', Game.time, '========');

  const aiTrace = trace.begin('ai')

  ai.tick(aiTrace);

  aiTrace.end();

  /*
  const kingdomTrace = trace.begin('kingdom');

  const kingdom = new Kingdom(config, kingdomTrace);
  kingdom.update();
  kingdom.process();

  kingdomTrace.end();
  */

  console.log('--------------------------------');

  trace.end();
  tracing.report();
};
