import {expect} from 'chai';
import 'mocha';
import {mockInstanceOf, mockStructure} from 'screeps-test-helper';

import {getRegion} from './lib.flood_fill';

describe('Flood Fill', function () {
  this.slow(5);

  describe('getRegion', () => {
    it('should return entire room for empty room', () => {
      const room = mockInstanceOf<Room>({
        name: 'E01S01',
        lookAt: () => {
          return [];
        },
        find: () => {
          return [];
        },
      });
      const region = getRegion(room, new RoomPosition(25, 25, room.name));
      expect(region.size).to.equal(2400);
    });

    it('should return single position region for center circle room', () => {
      const roomName = 'E01S01';
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x === 25 && y === 25) {
            return [];
          } else if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_WALL}}];
          }

          return [];
        },
        find: () => {
          return [];
        },
      });
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(region.size).to.equal(1);
      expect(Array.from(region.values())[0].x).to.equal(25);
      expect(Array.from(region.values())[0].y).to.equal(25);
    });

    it('should return nothing if start position is a wall', () => {
      const roomName = 'E01S01';
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x === 25 && y === 25) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_WALL}}];
          }

          return [];
        },
        find: () => {
          return [];
        },
      });
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(region.size).to.equal(0);
    });

    it('should region for larger circle of indestructible walls', () => {
      const roomName = 'E01S01';
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [];
          } else if (x >= 23 && x <= 27 && y >= 23 && y <= 27) {
            return [{type: LOOK_TERRAIN, terrain: 'wall'}];
          }

          return [];
        },
        find: () => {
          return [];
        },
      });
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(region.size).to.equal(9);
    });

    it('should region for larger circle of walls', () => {
      const roomName = 'E01S01';
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [];
          } else if (x >= 23 && x <= 27 && y >= 23 && y <= 27) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_WALL}}];
          }

          return [];
        },
        find: () => {
          return [];
        },
      });
      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(region.size).to.equal(9);
    });

    it('should region for larger circle of ramparts and include ramparts', () => {
      const roomName = 'E01S01';
      const room = mockInstanceOf<Room>({
        name: roomName,
        lookAt: (x, y) => {
          if (x >= 24 && x <= 26 && y >= 24 && y <= 26) {
            return [];
          } else if (x >= 23 && x <= 27 && y >= 23 && y <= 27) {
            return [{type: LOOK_STRUCTURES, structure: {structureType: STRUCTURE_RAMPART}}];
          }

          return [];
        },
        find: () => {
          // Return a square formation of ramparts around center
          return [
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(23, 23, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(23, 24, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(23, 25, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(23, 26, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(23, 27, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(24, 27, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(25, 27, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(26, 27, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(27, 27, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(27, 26, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(27, 25, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(27, 24, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(27, 23, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(26, 23, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(25, 23, roomName),
            }),
            mockStructure(STRUCTURE_SPAWN, {
              pos: RoomPosition(24, 23, roomName),
            }),
          ];
        },
      });

      const region = getRegion(room, new RoomPosition(25, 25, roomName));
      expect(region.size).to.equal(25);
    });
  });
});
