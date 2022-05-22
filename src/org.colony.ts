import {BaseConfig} from './config';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import {MEMORY_ROLE} from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing';
import {OrgBase} from './org.base';
import {Kingdom} from './org.kingdom';
import OrgRoom from './org.room';
import {thread, ThreadFunc} from './os.thread';
import {createSpawnRequest, getBaseSpawnTopic, requestSpawn} from './runnable.base_spawning';
import {getBaseDefenseTopic, getBaseHaulerTopic} from './topics';



const MAX_EXPLORERS = 3;

const UPDATE_ROOM_TTL = 1;
const UPDATE_CREEPS_TTL = 1;
const UPDATE_HAULERS_TTL = 5;

const REQUEST_MISSING_ROOMS_TTL = 25;
const REQUEST_DEFENDER_TTL = 5;
const REQUEST_EXPLORER_TTL = 200;
const HAULER_PID_TTL = 1;

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

  assignedCreeps: Creep[];
  numCreeps: number;

  // TODO refactor to make it more clear that this also counts workers
  numHaulers: number;
  numActiveHaulers: number;
  idleHaulers: number;
  avgHaulerCapacity: number;

  defenders: Creep[];

  threadUpdateOrg: ThreadFunc;
  threadUpdateCreeps: ThreadFunc;
  threadHandleDefenderRequest: ThreadFunc;
  threadRequestExplorer: ThreadFunc;
  threadHaulerPid: ThreadFunc;

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

    this.assignedCreeps = [];
    this.defenders = [];
    this.numCreeps = 0;
    this.threadUpdateCreeps = thread('update_creeps_thread', UPDATE_CREEPS_TTL)((trace: Tracer, kingdom: Kingdom) => {
      this.assignedCreeps = kingdom.getColonyCreeps(this.id);
      this.defenders = this.assignedCreeps.filter((creep) => {
        const role = creep.memory[MEMORY.MEMORY_ROLE];
        return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
          role === CREEPS.WORKER_DEFENDER_BOOSTED;
      });

      this.numCreeps = this.assignedCreeps.length;
    });

    this.numHaulers = 0;
    this.numActiveHaulers = 0;
    this.idleHaulers = 0;
    this.avgHaulerCapacity = 300;

    this.threadHandleDefenderRequest = thread('request_defenders_thread', REQUEST_DEFENDER_TTL)((trace, kingdom: Kingdom,
      baseConfig: BaseConfig) => {
      // Check intra-colony requests for defenders
      const request = kingdom.getNextRequest(getBaseDefenseTopic(this.id));
      if (request) {
        trace.log('got defender request', {request});
        this.handleDefenderRequest(request, baseConfig, trace);
      }
    });

    this.threadRequestExplorer = thread('request_explorers_thread', REQUEST_EXPLORER_TTL)(this.requestExplorer.bind(this))

    setupTrace.end();
  }

  update(trace) {
    const updateTrace = trace.begin('update');

    this.primaryRoom = Game.rooms[this.primaryRoomId];

    const removeStale = updateTrace.begin('remove_stale');
    this.topics.removeStale();
    removeStale.end();

    this.threadUpdateOrg(updateTrace);
    this.threadUpdateCreeps(updateTrace, this.getKingdom());
    this.threadHaulerPid(updateTrace);

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

    const baseConfig = this.getKingdom().getPlanner().getBaseConfigByRoom(this.primaryRoomId);
    if (baseConfig) {
      this.threadHandleDefenderRequest(updateTrace, this.getKingdom(), baseConfig);
      this.threadRequestExplorer(updateTrace, this.getKingdom(), baseConfig);
    }

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

  toString() {
    const topics = this.getKingdom().getTopics().getCounts();

    // TODO this should be shown on HUD
    return `* Colony - ID: ${this.id}, #Rooms: ${Object.keys(this.roomMap).length}, ` +
      `#Missing: ${this.missingRooms.length}, ` +
      `#Creeps: ${this.numCreeps}, ` +
      `#Haulers: ${this.numHaulers}, ` +
      `#HaulTasks: ${topics[getBaseHaulerTopic(this.baseId)] || 0}, ` +
      `AvgHaulerCapacity: ${this.avgHaulerCapacity}, ` +
      `#Defenders: ${this.defenders.length}`;
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

  getCreeps() {
    return this.assignedCreeps;
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

  getAvgHaulerCapacity() {
    return this.avgHaulerCapacity;
  }

  /**
   *
   * @deprecated removing and redoing later
   */
  updateStats(trace: Tracer) {
    const topicCounts = this.getKingdom().getTopics().getCounts();

    const colonyStats = {
      numHaulers: this.numHaulers,
      haulTasks: (topicCounts[getBaseHaulerTopic(this.baseId)] || 0) - this.idleHaulers,
      rooms: {},
      booster: {},
      spawner: {},
      topics: topicCounts,
    };

    const stats = this.getStats();
    stats.colonies[this.id] = colonyStats;
  }

  // TODO Move to base defense manager
  handleDefenderRequest(request, baseConfig: BaseConfig, trace) {
    trace.log('request details', {
      controllerLevel: this.primaryRoom?.controller ? this.primaryRoom?.controller : null,
      request,
    });

    if (request.details.spawn) {
      const spawnRequest = createSpawnRequest(request.priority, request.ttl, request.details.role,
        request.details.memory, 0)
      trace.log('requesting spawning of defenders', {request});
      requestSpawn(this.getKingdom(), getBaseSpawnTopic(baseConfig.id), spawnRequest);
      // @CONFIRM that defenders spawn
    }

    trace.info('requesting existing defense response', {request});

    // TODO replace with base defense topic
    // Order existing defenders to the room
    this.defenders.forEach((defender) => {
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
    });
  }

  requestExplorer(trace: Tracer, kingdom: Kingdom, baseConfig: BaseConfig) {
    if (!this.primaryRoom) {
      return;
    }

    const shardConfig = kingdom.config;
    if (!shardConfig.explorers) {
      trace.log('shard does not allow explorers');
      return;
    }

    const explorers = this.assignedCreeps.filter((creep) => {
      return creep.memory[MEMORY_ROLE] == CREEPS.WORKER_EXPLORER &&
        creep.memory[MEMORY.MEMORY_BASE] === this.id;
    });

    if (explorers.length < 0) {
      const oldExplorers = this.assignedCreeps.filter((creep) => {
        return creep.ticksToLive < CREEP_LIFE_TIME / MAX_EXPLORERS;
      });
      // If we do not have any old explorers, don't request any new ones
      if (!oldExplorers.length) {
        trace.log('no old explorers to replace');
        return;
      }
    }

    if (explorers.length < MAX_EXPLORERS) {
      trace.log('requesting explorer');

      const priority = PRIORITIES.EXPLORER;
      const ttl = REQUEST_EXPLORER_TTL;
      const role = CREEPS.WORKER_EXPLORER;
      const memory = {
        [MEMORY.MEMORY_BASE]: baseConfig.id,
      };
      const request = createSpawnRequest(priority, ttl, role, memory, 0);
      requestSpawn(kingdom, getBaseSpawnTopic(baseConfig.id), request);
      // @CONFIRM that explorers spawns
    } else {
      trace.log('not requesting explorer', {numExplorers: explorers.length});
    }
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
