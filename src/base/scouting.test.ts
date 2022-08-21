import {expect} from 'chai';
import 'mocha';
import {getNearbyRooms, getRoomCordFromRoomName, getRoomNameFromRoomCord} from './scouting';


describe('Scouting', function () {
  describe('getRoomNameFromRoomCord', function () {
    it('should return E0S0 0,0', function () {
      const roomCord = {x: 0, y: 0};
      const roomName = getRoomNameFromRoomCord(roomCord);
      expect(roomName).to.equal('E0S0');
    });

    it('should return E0S1 for 0,1', function () {
      const roomCord = {x: 0, y: 1};
      const roomName = getRoomNameFromRoomCord(roomCord);
      expect(roomName).to.equal('E0S1');
    });

    it('should return E1S0 for 1,0', function () {
      const roomCord = {x: 1, y: 0};
      const roomName = getRoomNameFromRoomCord(roomCord);
      expect(roomName).to.equal('E1S0');
    });

    it('should return W0N0 for -1,-1', function () {
      const roomCord = {x: -1, y: -1};
      const roomName = getRoomNameFromRoomCord(roomCord);
      expect(roomName).to.equal('W0N0');
    });

    it('should return W1N1 for -2,-2', function () {
      const roomCord = {x: -2, y: -2};
      const roomName = getRoomNameFromRoomCord(roomCord);
      expect(roomName).to.equal('W1N1');
    });
  });

  describe('getRoomCordFromRoomName', function () {
    it('should return 0,0 for E0S0', function () {
      const roomName = 'E0S0';
      const roomCord = getRoomCordFromRoomName(roomName);
      expect(roomCord).to.deep.equal({x: 0, y: 0});
    });

    it('should return 0,0 for E0S0', function () {
      const roomName = 'E00S00';
      const roomCord = getRoomCordFromRoomName(roomName);
      expect(roomCord).to.deep.equal({x: 0, y: 0});
    });

    it('should return 0,1 for E0S1', function () {
      const roomName = 'E0S1';
      const roomCord = getRoomCordFromRoomName(roomName);
      expect(roomCord).to.deep.equal({x: 0, y: 1});
    });

    it('should return 1,0 for E1S0', function () {
      const roomName = 'E1S0';
      const roomCord = getRoomCordFromRoomName(roomName);
      expect(roomCord).to.deep.equal({x: 1, y: 0});
    });

    it('should return -1,-1 for W0N0', function () {
      const roomName = 'W0N0';
      const roomCord = getRoomCordFromRoomName(roomName);
      expect(roomCord).to.deep.equal({x: -1, y: -1});
    });

    it('should return -2,-2 for W1N1', function () {
      const roomName = 'W1N1';
      const roomCord = getRoomCordFromRoomName(roomName);
      expect(roomCord).to.deep.equal({x: -2, y: -2});
    });
  });

  describe('getNearbyRooms', function () {
    it('should return no rooms when distance is 0', function () {
      const roomName = 'E0S0';
      const rooms = getNearbyRooms(roomName, 0);
      expect(rooms).to.deep.equal([]);
    });

    it('should return rooms within 1 of E5S5', function () {
      const roomName = 'E5S5';
      const rooms = getNearbyRooms(roomName, 1);
      const expected = ['E4S5', 'E6S5', 'E5S4', 'E5S6', 'E4S4', 'E6S4',
        'E4S6', 'E6S6'];
      expect(rooms).to.have.members(expected)
      expect(rooms.length).to.equal(expected.length);
    });

    it('should return rooms within 1 of W5N5', function () {
      const roomName = 'W5N5';
      const rooms = getNearbyRooms(roomName, 1);
      const expected = ['W4N5', 'W6N5', 'W5N4', 'W5N6', 'W4N4', 'W6N4',
        'W4N6', 'W6N6'];
      expect(rooms).to.have.members(expected)
      expect(rooms.length).to.equal(expected.length);
    });

    it('should return rooms within 1 of E0S0', function () {
      const roomName = 'E0S0';
      const rooms = getNearbyRooms(roomName, 1);
      const expected = ['W0N0', 'E0N0', 'E1N0', 'W0S0', 'E1S0', 'W0S1',
        'E0S1', 'E1S1'];
      expect(rooms).to.have.members(expected)
      expect(rooms.length).to.equal(expected.length);
    });

    it('should return rooms within 1 of W0N0', function () {
      const roomName = 'W0N0';
      const rooms = getNearbyRooms(roomName, 1);
      const expected = ['W1N1', 'W0N1', 'E0N1', 'W1N0', 'E0N0', 'W1S0',
        'W0S0', 'E0S0'];
      expect(rooms).to.have.members(expected)
      expect(rooms.length).to.equal(expected.length);
    });
  });
});
