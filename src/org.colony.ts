import OrgRoom from './org.room';
import {OrgBase} from './org.base';
import {Topics} from './lib.topics';
import * as PID from './lib.pid';
import {thread, ThreadFunc} from './os.thread';

import * as MEMORY from './constants.memory';
import * as CREEPS from './constants.creeps';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import * as PRIORITIES from './constants.priorities';
import {creepIsFresh} from './behavior.commute';

import {MEMORY_ASSIGN_ROOM, MEMORY_ROLE, MEMORY_COLONY} from './constants.memory';
import {TOPIC_SPAWN, TOPIC_DEFENDERS, TOPIC_HAUL_TASK} from './constants.topics';
import {WORKER_RESERVER, WORKER_DEFENDER} from './constants.creeps';
import {PRIORITY_CLAIMER, PRIORITY_DEFENDER, PRIORITY_HAULER} from './constants.priorities';
import {Kingdom} from './org.kingdom';
import {ColonyConfig} from './config';
import {Tracer} from './lib.tracing';

const MAX_EXPLORERS = 3;

const UPDATE_ROOM_TTL = 1;
const UPDATE_CREEPS_TTL = 1;
const UPDATE_HAULERS_TTL = 5;

const REQUEST_MISSING_ROOMS_TTL = 25;
const REQUEST_HAULER_TTL = 25;
const REQUEST_DEFENDER_TTL = 5;
const REQUEST_EXPLORER_TTL = 200;

export class Colony extends OrgBase {
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
  automated: boolean;
  origin: RoomPosition;

  assignedCreeps: Creep[];
  numCreeps: number;

  haulers: Creep[];
  numHaulers: number;
  numActiveHaulers: number;
  idleHaulers: number;
  avgHaulerCapacity: number;

  defenders: Creep[];

  pidDesiredHaulers: number;
  pidSetup: boolean;

  threadUpdateOrg: ThreadFunc;
  threadUpdateCreeps: ThreadFunc;
  threadUpdateHaulers: ThreadFunc;
  threadHandleDefenderRequest: ThreadFunc;
  threadRequestReserversForMissingRooms: ThreadFunc;
  threadRequestHaulers: ThreadFunc;
  threadRequestExplorer: ThreadFunc;

  constructor(parent: Kingdom, config: ColonyConfig, trace: Tracer) {
    super(parent, config.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.topics = new Topics();

    this.primaryRoomId = config.primary;
    this.desiredRooms = config.rooms;
    this.primaryRoom = Game.rooms[this.primaryRoomId];
    this.isPublic = config.isPublic || false;
    this.automated = config.automated;
    this.origin = config.origin;

    this.pidDesiredHaulers = 0;
    this.pidSetup = false;

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

    this.haulers = [];
    this.numHaulers = 0;
    this.numActiveHaulers = 0;
    this.idleHaulers = 0;
    this.avgHaulerCapacity = 300;
    this.threadUpdateHaulers = thread('update_haulers_thread', UPDATE_HAULERS_TTL)(() => {
      this.haulers = this.assignedCreeps.filter((creep) => {
        return creep.memory[MEMORY_ROLE] === CREEPS.WORKER_HAULER &&
          creep.memory[MEMORY_COLONY] === this.id &&
          creepIsFresh(creep);
      });

      this.numHaulers = this.haulers.length;

      this.numActiveHaulers = this.haulers.filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        return task === TASKS.TASK_HAUL;
      }).length;

      this.idleHaulers = this.numHaulers - this.numActiveHaulers;

      // Updating the avg when there are no haulers causes some undesirable
      // situations (task explosion)
      if (this.numHaulers) {
        this.avgHaulerCapacity = this.haulers.reduce((total, hauler) => {
          return total + hauler.store.getCapacity();
        }, 0) / this.haulers.length;

        if (this.avgHaulerCapacity < 300) {
          this.avgHaulerCapacity = 300;
        }
      }
    });

    this.threadHandleDefenderRequest = thread('request_defenders_thread', REQUEST_DEFENDER_TTL)((trace) => {
      // Check intra-colony requests for defenders
      const request = this.getNextRequest(TOPIC_DEFENDERS);
      if (request) {
        trace.log('got defender request', {request});
        this.handleDefenderRequest(request, trace);
      }
    });

    this.threadRequestReserversForMissingRooms = thread('request_servers_thread', REQUEST_MISSING_ROOMS_TTL)((trace) => {
      this.requestReserverForMissingRooms(trace);
    });

    this.threadRequestHaulers = thread('request_haulers_thread', REQUEST_HAULER_TTL)((trace: Tracer) => {
      this.requestHaulers(trace);
    });

    this.threadRequestExplorer = thread('request_explorers_thread', REQUEST_EXPLORER_TTL)((trace) => {
      this.requestExplorer(trace);
    });

    setupTrace.end();
  }

  update(trace) {
    const updateTrace = trace.begin('update');

    const removeStale = updateTrace.begin('remove_stale');
    this.topics.removeStale();
    removeStale.end();

    this.primaryRoom = Game.rooms[this.primaryRoomId];

    this.threadUpdateOrg(updateTrace);
    this.threadUpdateCreeps(updateTrace, this.getKingdom());
    this.threadUpdateHaulers(updateTrace);

    // Fraction of num haul tasks
    let numHaulTasks = this.getTopicLength(TOPIC_HAUL_TASK);
    numHaulTasks -= this.idleHaulers;

    if (this.primaryRoom) {
      if (!this.pidSetup) {
        trace.log('setting up pid', {pidDesiredHaulers: this.pidDesiredHaulers});
        this.pidSetup = true;
        PID.setup(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS, 0, 0.2, 0.001, 0);
      }

      const updateHaulerPID = updateTrace.begin('update_hauler_pid');
      this.pidDesiredHaulers = PID.update(this.primaryRoomId, this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS,
        numHaulTasks, Game.time, updateHaulerPID);
      updateHaulerPID.log('desired haulers', {desired: this.pidDesiredHaulers});
      updateHaulerPID.end();
    }

    const roomTrace = updateTrace.begin('rooms');
    Object.values(this.roomMap).forEach((room) => {
      room.update(roomTrace.withFields({room: room.id}));
    });
    roomTrace.end();

    this.threadRequestReserversForMissingRooms(updateTrace);
    this.threadHandleDefenderRequest(updateTrace);

    if (this.primaryOrgRoom && this.primaryOrgRoom.hasStorage) {
      this.threadRequestHaulers(updateTrace);
    }

    this.threadRequestExplorer(trace);

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
    const topics = this.topics.getCounts();

    return `* Colony - ID: ${this.id}, #Rooms: ${Object.keys(this.roomMap).length}, ` +
      `#Missing: ${this.missingRooms.length}, ` +
      `#Creeps: ${this.numCreeps}, ` +
      `#Haulers: ${this.numHaulers}, ` +
      `#HaulTasks: ${topics[TOPICS.TOPIC_HAUL_TASK] || 0}, ` +
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

  isAutomated(): boolean {
    return this.automated;
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
  getHaulers() {
    return this.haulers;
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
  updateStats(trace: Tracer) {
    const topicCounts = this.topics.getCounts();

    const colonyStats = {
      numHaulers: this.numHaulers,
      haulTasks: (topicCounts[TOPICS.TOPIC_HAUL_TASK] || 0) - this.idleHaulers,
      pidDesiredHaulers: this.pidDesiredHaulers,
      rooms: {},
      booster: {},
      spawner: {},
      topics: topicCounts,
    };

    const stats = this.getStats();
    stats.colonies[this.id] = colonyStats;
  }
  handleDefenderRequest(request, trace) {
    trace.log('request details', {
      hasSpawns: this.primaryOrgRoom ? this.primaryOrgRoom.hasSpawns : null,
      controllerLevel: this.primaryRoom?.controller ? this.primaryRoom?.controller : null,
      request,
    });

    if (request.details.spawn) {
      // If the colony has spawners and is of sufficient size spawn own defenders,
      // otherwise ask for help from other colonies
      if (this.primaryOrgRoom?.hasSpawns && this.primaryRoom?.controller?.level > 3) {
        trace.log('requesting from colony');
        this.sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, request.details, REQUEST_DEFENDER_TTL);
      } else {
        request.details.memory[MEMORY.MEMORY_COLONY] = this.id;
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, request.details, REQUEST_DEFENDER_TTL);
      }
    }

    trace.log('requesting defense response', {memory: request.details.memory});

    // Order existing defenders to the room
    this.defenders.forEach((defender) => {
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
    });
  }
  requestHaulers(trace: Tracer) {
    if (this.primaryRoom) {
      if (Game.cpu.bucket < 2000) {
        trace.notice('bucket is low, not requesting haulers', {bucket: Game.cpu.bucket});
        return;
      }

      // PID approach
      if (this.numHaulers < this.pidDesiredHaulers) {
        const priority = PRIORITY_HAULER + this.pidDesiredHaulers - this.numHaulers;
        trace.notice('requesting hauler', {priority});
        this.sendRequest(TOPIC_SPAWN, priority, {
          role: CREEPS.WORKER_HAULER,
          memory: {},
        }, REQUEST_HAULER_TTL);
      }
    }
  }

  requestExplorer(trace: Tracer) {
    if (!this.primaryRoom) {
      return;
    }

    const numExplorers = this.assignedCreeps.filter((creep) => {
      return creep.memory[MEMORY_ROLE] == CREEPS.WORKER_EXPLORER &&
        creep.memory[MEMORY_COLONY] === this.id;
    }).length;

    if (numExplorers < MAX_EXPLORERS) {
      trace.notice('requesting explorer');

      this.sendRequest(TOPIC_SPAWN, PRIORITIES.EXPLORER, {
        role: CREEPS.WORKER_EXPLORER,
        memory: {},
      }, REQUEST_EXPLORER_TTL);
    } else {
      trace.notice('not requesting explorer', {numExplorers});
    }
  }

  requestReserverForMissingRooms(trace: Tracer) {
    trace.log("missing rooms", {missingRooms: this.missingRooms});
    this.missingRooms.forEach((roomID) => {
      const reservers = this.assignedCreeps.filter((creep) => {
        return creep.memory[MEMORY_ROLE] == CREEPS.WORKER_RESERVER &&
          creep.memory[MEMORY_ASSIGN_ROOM] === roomID;
      });

      // A reserver is already assigned, don't send more
      if (reservers.length) {
        trace.log("have reserver already", {reservers: reservers.map(c => c.id)});
        return;
      }

      // Bootstrapping a new colony requires another colony sending
      // creeps to claim and build a spawner
      const details = {
        role: WORKER_RESERVER,
        memory: {
          [MEMORY_ASSIGN_ROOM]: roomID,
          [MEMORY.MEMORY_COLONY]: this.id,
        },
      };

      if (this.primaryOrgRoom && this.primaryOrgRoom.hasSpawns &&
        this.primaryOrgRoom.room.energyCapacityAvailable >= 800) {
        trace.notice('requesting claimer from colony', {details});
        this.sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, details, REQUEST_MISSING_ROOMS_TTL);
      } else {
        trace.notice('requesting claimer from kingdom', {details});
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, details, REQUEST_MISSING_ROOMS_TTL);
      }
    });
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
        trace.error('missing room not found', {id});
        return;
      }

      const orgNode = new OrgRoom(this, room, trace);
      this.roomMap[id] = orgNode;
      this.getKingdom().roomNameToOrgRoom[id] = orgNode;
    });

    const extraOrgColonyIds = _.difference(orgRoomIds, desiredRoomIds);
    extraOrgColonyIds.forEach((id) => {
      delete this.roomMap[id];
      delete this.getKingdom().roomNameToOrgRoom[id];
    });

    if (this.roomMap[this.primaryRoomId]) {
      this.primaryOrgRoom = this.roomMap[this.primaryRoomId];
    } else {
      trace.error('primary room not found', {primaryRoomId: this.primaryRoomId});
    }

    updateOrgTrace.end();
  }
}
