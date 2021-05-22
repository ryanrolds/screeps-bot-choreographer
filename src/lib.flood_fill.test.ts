import 'mocha';
import {expect} from 'chai';
import * as sinon from 'sinon';
import {stubObject, StubbedInstance} from "ts-sinon";
import {setup, mockGlobal, mockInstanceOf} from "screeps-test-helper";
import * as _ from "lodash";

import {getRegion} from './lib.flood_fill';

describe('Flood Fill', function () {
  this.slow(5);

  describe('getRegion', () => {
    it("should return entire room for empty room", () => {
      const room = mockInstanceOf<Room>({
        name: 'E01S01',
        lookAt: () => {
          return [];
        }
      })
      const region = getRegion(room, new RoomPosition(25, 25, room.name));
      expect(Object.values(region).length).to.equal(2400);
    });

    it("should return single position region for center circle room", () => {
      const roomName = 'E01S01'
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x === 25 && y === 25) {
            return [];
          } else if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_WALL}}];
          }

          return [];
        }
      })
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(Object.values(region).length).to.equal(1);
      expect(Object.values(region)[0].x).to.equal(25);
      expect(Object.values(region)[0].y).to.equal(25);
    });

    it("should return nothing if start position is a wall", () => {
      const roomName = 'E01S01'
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x === 25 && y === 25) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_WALL}}]
          }

          return [];
        }
      })
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(Object.values(region).length).to.equal(0);
    });

    it("should region for larger circle of walls", () => {
      const roomName = 'E01S01'
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [];
          } else if (x >= 23 && x <= 27 && y >= 23 && y <= 27) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_WALL}}];
          }

          return [];
        }
      })
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(Object.values(region).length).to.equal(9);
    });

    it("should region for larger circle of ramparts", () => {
      const roomName = 'E01S01'
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [];
          } else if (x >= 23 && x <= 27 && y >= 23 && y <= 27) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_RAMPART}}];
          }

          return [];
        }
      })
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(Object.values(region).length).to.equal(9);
    });
  });
});
