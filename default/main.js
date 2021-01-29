const tracing = require('./lib.tracing');
const Kingdom = require('./org.kingdom');

global.TRACING_ACTIVE = false;

let config = {
  'E18S48': {
    id: 'E18S48-Shard3',
    primary: 'E18S48',
    rooms: ['E18S48' /*, 'E17S48' */],
  },
  'E18S47': {
    id: 'E18S47-Shard3',
    primary: 'E18S47',
    rooms: ['E18S47' /*, 'E19S46' */],
  },
  'E18S45': {
    id: 'E18S45-Shard3',
    primary: 'E18S45',
    rooms: ['E18S45' /*, 'E19S45' */],
  },
  'E17S49': {
    id: 'E17S49-Shard3',
    primary: 'E17S49',
    rooms: ['E17S49' /*, 'E16S49' */],
  },
  'E15S48': {
    id: 'E15S48-Shard3',
    primary: 'E15S48',
    rooms: ['E15S48'],
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

module.exports.loop = function() {
  if (global.TRACING_ACTIVE === true) {
    tracing.setActive();
  } else {
    tracing.setInactive()
  }

  const trace = tracing.startTrace('main');

  console.log('======== TICK', Game.time, '========');

  const kingdomTrace = trace.begin('kingdom');

  const kingdom = new Kingdom(config, kingdomTrace);
  kingdom.update();
  kingdom.process();

  kingdomTrace.end();

  trace.end();
  tracing.report();

  console.log('--------------------------------');
};
