import 'mocha';
import {expect} from 'chai';
import * as _ from "lodash";
import Sinon, * as sinon from 'sinon';
import {stubObject, StubbedInstance} from "ts-sinon";
import {setup, mockGlobal, mockInstanceOf} from "screeps-test-helper";

describe('Pathing', function () {
  beforeEach(() => {
    mockGlobal<Game>('Game', {});
  });
});
