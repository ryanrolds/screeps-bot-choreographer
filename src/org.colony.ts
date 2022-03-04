import OrgRoom from './org.room';
import {OrgBase} from './org.base';
import {Topics} from './lib.topics';
import * as PID from './lib.pid';
import {thread, ThreadFunc} from './os.thread';

import * as MEMORY from './constants.memory';
import * as CREEPS from './constants.creeps';
import * as TASKS from './constants.tasks';
import * as PRIORITIES from './constants.priorities';
import {creepIsFresh} from './behavior.commute';

import {MEMORY_ASSIGN_ROOM, MEMORY_ROLE} from './constants.memory';
import {PRIORITY_DEFENDER, PRIORITY_HAULER} from './constants.priorities';
import {Kingdom} from './org.kingdom';
import {BaseConfig} from './config';
import {Tracer} from './lib.tracing';
import {getBaseDefenseTopic, getBaseHaulerTopic, getBaseSpawnTopic} from './topics.base';

const MAX_EXPLORERS = 3;

const UPDATE_ROOM_TTL = 1;
const UPDATE_CREEPS_TTL = 1;
const UPDATE_HAULERS_TTL = 5;

const REQUEST_MISSING_ROOMS_TTL = 25;
const REQUEST_HAULER_TTL = 25;
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
  automated: boolean;
  origin: RoomPosition;

  assignedCreeps: Creep[];
  numCreeps: number;

  haulers: Creep[];
  // TODO refactor to make it more clear that this also counts workers
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
  threadRequestHaulers: ThreadFunc;
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
    this.automated = baseConfig.automated;
    this.origin = baseConfig.origin;

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
      // Get list of haulers and workers
      this.haulers = this.assignedCreeps.filter((creep) => {
        return (creep.memory[MEMORY_ROLE] === CREEPS.WORKER_HAULER ||
          creep.memory[MEMORY_ROLE] === CREEPS.ROLE_WORKER) &&
          creep.memory[MEMORY.MEMORY_BASE] === this.id &&
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

        if (this.avgHaulerCapacity < 50) {
          this.avgHaulerCapacity = 50;
        }
      }
    });

    this.threadHandleDefenderRequest = thread('request_defenders_thread', REQUEST_DEFENDER_TTL)((trace, kingdom: Kingdom) => {
      // Check intra-colony requests for defenders
      const request = kingdom.getNextRequest(getBaseDefenseTopic(this.id));
      if (request) {
        trace.log('got defender request', {request});
        this.handleDefenderRequest(request, trace);
      }
    });

    this.threadRequestHaulers = thread('request_haulers_thread', REQUEST_HAULER_TTL)((trace: Tracer) => {
      this.requestHaulers(trace);
    });

    this.threadHaulerPid = thread('hauler_pid_thread', HAULER_PID_TTL)((trace: Tracer) => {
      // Fraction of num haul tasks
      let numHaulTasks = this.getKingdom().getTopicLength(getBaseHaulerTopic(this.baseId));
      numHaulTasks -= this.idleHaulers;

      trace.log('haul tasks', {numHaulTasks, numIdleHaulers: this.idleHaulers});

      if (this.primaryRoom) {
        if (!this.pidSetup) {
          trace.log('setting up pid', {pidDesiredHaulers: this.pidDesiredHaulers});
          this.pidSetup = true;
          PID.setup(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS, 0, 0.2, 0.001, 0);
        }

        const updateHaulerPID = trace.begin('update_hauler_pid');
        this.pidDesiredHaulers = PID.update(this.primaryRoomId, this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS,
          numHaulTasks, Game.time, updateHaulerPID);
        updateHaulerPID.log('desired haulers', {desired: this.pidDesiredHaulers});
        updateHaulerPID.end();

        trace.log('desired haulers', {desired: this.pidDesiredHaulers});
      }
    })

    this.threadRequestExplorer = thread('request_explorers_thread', REQUEST_EXPLORER_TTL)((trace, kingdom) => {
      this.requestExplorer(trace, kingdom);
    });

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
    this.threadUpdateHaulers(updateTrace);
    this.threadHaulerPid(updateTrace);

    const roomTrace = updateTrace.begin('rooms');
    Object.values(this.roomMap).forEach((room) => {
      room.update(roomTrace.withFields({room: room.id}));
    });
    roomTrace.end();

    this.threadHandleDefenderRequest(updateTrace, this.getKingdom());
    this.threadRequestHaulers(updateTrace);
    this.threadRequestExplorer(updateTrace, this.getKingdom());

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
    const topicCounts = this.getKingdom().getTopics().getCounts();

    const colonyStats = {
      numHaulers: this.numHaulers,
      haulTasks: (topicCounts[getBaseHaulerTopic(this.baseId)] || 0) - this.idleHaulers,
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
      controllerLevel: this.primaryRoom?.controller ? this.primaryRoom?.controller : null,
      request,
    });

    if (request.details.spawn) {
      trace.log('requesting spawning of defenders');
      this.getKingdom().sendRequest(getBaseSpawnTopic(this.id), PRIORITY_DEFENDER, request.details,
        REQUEST_DEFENDER_TTL);
    }

    trace.notice('requesting existing defense response', {request});

    // Order existing defenders to the room
    this.defenders.forEach((defender) => {
      trace.notice('sending existing defender to room', {defender});
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
    });
  }

  requestHaulers(trace: Tracer) {
    if (!this.primaryRoom) {
      trace.error('not primary room');
    }

    if (Game.cpu.bucket < 2000) {
      trace.warn('bucket is low, not requesting haulers', {bucket: Game.cpu.bucket});
      return;
    }

    let role = CREEPS.WORKER_HAULER;
    if (!this.primaryOrgRoom?.hasStorage) {
      role = CREEPS.ROLE_WORKER;
    }

    trace.log('request haulers', {numHaulers: this.numHaulers, desiredHaulers: this.pidDesiredHaulers})

    // PID approach
    if (this.numHaulers < this.pidDesiredHaulers) {
      let priority = PRIORITY_HAULER;

      // If we have few haulers/workers we should not be prioritizing haulers
      if (this.pidDesiredHaulers > 3 && this.numHaulers < 2) {
        priority + 10;
      }

      priority -= this.numHaulers * 0.2

      const details = {
        role,
        memory: {
          [MEMORY.MEMORY_BASE]: this.id,
        }
      };

      trace.log('requesting hauler/worker', {role, priority, details});

      this.primaryOrgRoom.requestSpawn(priority, details, REQUEST_HAULER_TTL, trace);
    }
  }

  requestExplorer(trace: Tracer, kingdom: Kingdom) {
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

      this.getKingdom().sendRequest(getBaseSpawnTopic(this.id), PRIORITIES.EXPLORER, {
        role: CREEPS.WORKER_EXPLORER,
        memory: {},
      }, REQUEST_EXPLORER_TTL);
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
      trace.error('primary room not found', {orgColonyId: this.id, primaryRoomId: this.primaryRoomId, missingOrgColonyIds, extraOrgColonyIds, desiredRoomIds, orgRoomIds});
    }

    updateOrgTrace.end();
  }
}
