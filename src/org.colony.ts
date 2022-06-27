import {BaseConfig} from './config';
import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {OrgBase} from './org.base';
import {Kingdom} from './org.kingdom';
import OrgRoom from './org.room';
import {thread, ThreadFunc} from './os.thread';

const UPDATE_ROOM_TTL = 1;
export class Colony extends OrgBase {
  baseId: string;
  topics: Topics;
  desiredRooms: string[];
  missingRooms: string[];
  colonyRooms: string[];
  visibleRooms: string[];
  roomMap: Record<string, OrgRoom>;

  primaryRoomId: string;
  primaryRoom: Room;
  primaryOrgRoom: OrgRoom;

  isPublic: boolean;
  origin: RoomPosition;

  threadUpdateOrg: ThreadFunc;

  constructor(parent: Kingdom, baseConfig: BaseConfig, trace: Tracer) {
    super(parent, baseConfig.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.baseId = baseConfig.id;
    this.topics = new Topics();

    this.primaryRoomId = baseConfig.primary;
    this.desiredRooms = baseConfig.rooms;
    this.primaryRoom = Game.rooms[this.primaryRoomId];
    this.isPublic = baseConfig.isPublic || false;
    this.origin = baseConfig.origin;

    this.roomMap = {};
    this.primaryOrgRoom = null;
    this.threadUpdateOrg = thread('update_org_thread', UPDATE_ROOM_TTL)(this.updateOrg.bind(this));

    setupTrace.end();
  }

  update(trace) {
    const updateTrace = trace.begin('update');

    this.primaryRoom = Game.rooms[this.primaryRoomId];

    const removeStale = updateTrace.begin('remove_stale');
    this.topics.removeStale();
    removeStale.end();

    this.threadUpdateOrg(updateTrace);

    const roomTrace = updateTrace.begin('rooms');
    Object.values(this.roomMap).forEach((room) => {
      const baseConfig = this.getKingdom().getPlanner().getBaseConfigByRoom(room.id);
      if (!baseConfig) {
        roomTrace.warn('no base config for colony room, removing', {room: room.id});
        delete this.roomMap[room.id];
        delete this.getKingdom().roomNameToOrgRoom[room.id];
        return;
      }

      room.update(roomTrace.withFields({room: room.id}));
    });
    roomTrace.end();

    updateTrace.end();
  }

  process(trace: Tracer) {
    const processTrace = trace.begin('process');

    this.updateStats(processTrace);

    const roomTrace = processTrace.begin('rooms');
    Object.values(this.roomMap).forEach((room) => {
      room.process(roomTrace);
    });
    roomTrace.end();

    processTrace.end();
  }

  getColony(): Colony {
    return this;
  }
  getRoom(): OrgRoom {
    throw new Error('a colony is not a room');
  }
  getPrimaryRoom(): OrgRoom {
    return this.primaryOrgRoom;
  }

  getRoomByID(roomId) {
    return this.roomMap[roomId] || null;
  }

  getOrigin(): RoomPosition {
    return this.origin;
  }

  getSpawnPos(): RoomPosition {
    const originSpawn = this.primaryOrgRoom.getSpawns()[0];
    if (!originSpawn) {
      return null;
    }

    return originSpawn.pos;
  }

  sendRequest(topic, priority, request, ttl) {
    this.topics.addRequest(topic, priority, request, ttl);
  }
  getNextRequest(topic) {
    return this.topics.getNextRequest(topic);
  }
  peekNextRequest(topic) {
    return this.topics.peekNextRequest(topic);
  }
  getTopicLength(topic) {
    return this.topics.getLength(topic);
  }
  getTopics() {
    return this.topics;
  }
  getFilteredRequests(topicId, filter) {
    return this.topics.getFilteredRequests(topicId, filter);
  }
  getMessageOfMyChoice(topicId, chooser) {
    return this.topics.getMessageOfMyChoice(topicId, chooser);
  }
  getReserveStructures() {
    if (!this.primaryOrgRoom) {
      return [];
    }

    return this.primaryOrgRoom.getReserveStructures(false);
  }
  getReserveResources() {
    if (!this.primaryOrgRoom) {
      return {};
    }

    return this.primaryOrgRoom.getReserveResources();
  }
  getAmountInReserve(resource) {
    if (!this.primaryOrgRoom) {
      return 0;
    }

    return this.primaryOrgRoom.getAmountInReserve(resource);
  }
  getReserveStructureWithMostOfAResource(resource) {
    if (!this.primaryOrgRoom) {
      return null;
    }

    return this.primaryOrgRoom.getReserveStructureWithMostOfAResource(resource, false);
  }

  getReserveStructureWithRoomForResource(resource) {
    if (!this.primaryOrgRoom) {
      return null;
    }

    return this.primaryOrgRoom.getReserveStructureWithRoomForResource(resource);
  }

  /**
   *
   * @deprecated removing and redoing later
   */
  updateStats(trace: Tracer) {
    const topicCounts = this.getKingdom().getTopics().getCounts();

    const colonyStats = {
      rooms: {},
      booster: {},
      spawner: {},
      topics: topicCounts,
    };

    const stats = this.getStats();
    stats.colonies[this.id] = colonyStats;
  }

  updateOrg(trace: Tracer) {
    const updateOrgTrace = trace.begin('update_org');

    this.visibleRooms = Object.keys(Game.rooms);

    // If primary room is not owned by me, count as missing
    if (!this.primaryRoom?.controller?.my) {
      this.visibleRooms = this.visibleRooms.filter((roomId) => {
        return roomId !== this.primaryRoomId;
      });
    }

    this.missingRooms = _.difference(this.desiredRooms, this.visibleRooms);
    this.colonyRooms = _.difference(this.desiredRooms, this.missingRooms);

    // Rooms
    const desiredRoomIds = this.desiredRooms;
    const orgRoomIds = Object.keys(this.roomMap);

    const missingOrgColonyIds = _.difference(desiredRoomIds, orgRoomIds);
    missingOrgColonyIds.forEach((id) => {
      const room = Game.rooms[id];
      if (!room) {
        trace.warn('missing room not found', {id});
        return;
      }

      trace.warn('creating missing room found', {id});
      const orgNode = new OrgRoom(this, room, trace);
      this.roomMap[id] = orgNode;
      this.getKingdom().roomNameToOrgRoom[id] = orgNode;
    });

    const extraOrgColonyIds = _.difference(orgRoomIds, desiredRoomIds);
    extraOrgColonyIds.forEach((id) => {
      trace.warn('removing extra room', {id});
      delete this.roomMap[id];
      delete this.getKingdom().roomNameToOrgRoom[id];
    });

    if (this.roomMap[this.primaryRoomId]) {
      this.primaryOrgRoom = this.roomMap[this.primaryRoomId];
    } else {
      trace.error('primary room not found', {orgColonyId: this.id, primaryRoomId: this.primaryRoomId, missingOrgColonyIds, extraOrgColonyIds, desiredRoomIds, orgRoomIds});
    }

    updateOrgTrace.end();
  }
}
