import 'mocha';
import {mockGlobal} from 'screeps-test-helper';

describe('Pathing', function() {
  beforeEach(() => {
    mockGlobal<Game>('Game', {});
  });
});
