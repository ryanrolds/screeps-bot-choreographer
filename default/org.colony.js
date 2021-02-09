const Room = require('./org.room');
const OrgBase = require('./org.base');
const Topics = require('./lib.topics');
const Pid = require('./lib.pid');
const {doEvery} = require('./lib.scheduler');

const MEMORY = require('./constants.memory');
const WORKERS = require('./constants.creeps');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const {creepIsFresh} = require('./behavior.commute');

const {MEMORY_ASSIGN_ROOM, MEMORY_ROLE, MEMORY_COLONY} = require('./constants.memory');
const {TOPIC_SPAWN, TOPIC_DEFENDERS, TOPIC_HAUL_TASK} = require('./constants.topics');
const {WORKER_RESERVER, WORKER_DEFENDER} = require('./constants.creeps');
const {PRIORITY_CLAIMER, PRIORITY_DEFENDER, PRIORITY_HAULER} = require('./constants.priorities');

const MAX_DEFENDERS = 3;
const REQUEST_MISSING_ROOMS_TTL = 200;
const REQUEST_HAULER_TTL = 75;
const REQUEST_DEFENDER_TTL = 100;
const UPDATE_ROOM_TTL = 1;

class Colony extends OrgBase {
  constructor(parent, colony, trace) {
    super(parent, colony.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.topics = new Topics();

    this.primaryRoomId = colony.primary;
    this.desiredRooms = colony.rooms;
    this.primaryRoom = Game.rooms[this.primaryRoomId];

    this.roomMap = {};
    this.pidDesiredHaulers = 0;

    if (this.primaryRoom) {
      Pid.setup(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS, 1, 0.15, 0.00009, 0);
    }

    this.doUpdateOrg = doEvery(UPDATE_ROOM_TTL)((trace) => {
      this.updateOrg(trace);
    })

    this.doRequestReserversForMissingRooms = doEvery(REQUEST_MISSING_ROOMS_TTL)(() => {
      this.requestReserverForMissingRooms();
    })

    this.doRequestHaulers = doEvery(REQUEST_HAULER_TTL)(() => {
      this.requestHaulers();
    })

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update')

    this.topics.removeStale();

    this.primaryRoom = Game.rooms[this.primaryRoomId];

    this.assignedCreeps = this.getParent().getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_COLONY] === this.id;
    });
    this.numCreeps = this.assignedCreeps.length

    this.doUpdateOrg(updateTrace)

    this.defenders = this.assignedCreeps.filter((creep) => {
      return creep.memory[MEMORY_ROLE] == WORKER_DEFENDER &&
        creep.memory[MEMORY_COLONY] === this.id;
    });

    this.haulers = this.assignedCreeps.filter((creep) => {
      return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_HAULER &&
        creep.memory[MEMORY_COLONY] === this.id &&
        creepIsFresh(creep);
    });

    this.numHaulers = this.haulers.length;

    this.numActiveHaulers = this.haulers.filter((creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      return task === TASKS.TASK_HAUL;
    }).length

    this.idleHaulers = this.numHaulers - this.numActiveHaulers

    // TODO update every X ticks
    this.avgHaulerCapacity = this.haulers.reduce((total, hauler) => {
      return total + hauler.store.getCapacity();
    }, 0) / this.haulers.length;

    // Fraction of num haul tasks
    let numHaulTasks = this.getTopicLength(TOPIC_HAUL_TASK);
    numHaulTasks -= this.idleHaulers;

    this.pidDesiredHaulers = Pid.update(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS,
      numHaulTasks, Game.time);

    this.doRequestReserversForMissingRooms();

    const roomTrace = updateTrace.begin('rooms');
    Object.values(this.roomMap).forEach((room) => {
      room.update(roomTrace);
    });
    roomTrace.end();

    // Check intra-colony requests for defenders
    const request = this.getNextRequest(TOPIC_DEFENDERS);
    if (request) {
      this.handleDefenderRequest(request)
    }

    if (this.primaryOrgRoom.hasStorage) {
      this.doRequestHaulers();
    }

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    this.updateStats();

    const roomTrace = processTrace.begin('rooms');
    Object.values(this.roomMap).forEach((room) => {
      room.process(roomTrace);
    });
    roomTrace.end();

    processTrace.end();
  }
  toString() {
    return `** Colony - ID: ${this.id}, #Rooms: ${Object.keys(this.roomMap).length}, ` +
      `#Missing: ${this.missingRooms.length}, ` +
      `#Haulers: ${this.numHaulers}, ` +
      `AvgHaulerCapacity: ${this.avgHaulerCapacity}, ` +
      `#Defenders: ${this.defenders.length}`;
  }
  getColony() {
    return this;
  }
  getRoom() {
    throw new Error('a colony is not a room');
  }
  getPrimaryRoom() {
    return this.primaryOrgRoom;
  }
  getRoomByID(roomId) {
    return this.roomMap[roomId] || null;
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
  getReserveStructures() {
    if (!this.primaryRoom) {
      return [];
    }

    return this.primaryRoom.getReserveStructures();
  }
  getReserveResources(includeTerminal) {
    if (!this.primaryOrgRoom) {
      return {};
    }

    return this.primaryOrgRoom.getReserveResources(includeTerminal);
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

    return this.primaryOrgRoom.getReserveStructureWithMostOfAResource(resource);
  }
  getStructureWithMostOfAResource(resource) {
    if (!this.primaryOrgRoom) {
      return null;
    }

    return this.primaryOrgRoom.getStructureWithMostOfAResource(resource);
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
  updateStats() {
    let topicCounts = this.topics.getCounts();

    const colonyStats = {
      numHaulers: this.numHaulers,
      haulTasks: (topicCounts[TOPICS.TOPIC_HAUL_TASK] || 0) - this.idleHaulers,
      haulerSetpoint: this.haulerSetpoint,
      pidDesiredHaulers: this.pidDesiredHaulers,
      rooms: {},
      booster: {},
      spawner: {},
      topics: topicCounts,
    };

    const stats = this.getStats();
    stats.colonies[this.id] = colonyStats;
  }
  handleDefenderRequest(request) {
    console.log('DEFENDER REQUEST', JSON.stringify(request));

    const neededDefenders = MAX_DEFENDERS - this.defenders.length;
    if (neededDefenders > 0) {
      // If the colony has spawners and is of sufficient size spawn own defenders,
      // otherwise ask for help from other colonies
      if (this.primaryOrgRoom && this.primaryOrgRoom.hasSpawns &&
        (this.primaryRoom && this.primaryRoom.controller.level > 3)) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, request.details, REQUEST_DEFENDER_TTL);
      } else {
        request.details.memory[MEMORY.MEMORY_COLONY] = this.id;
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, request.details, REQUEST_DEFENDER_TTL);
      }
    }

    // Order existing defenders to the room
    this.defenders.forEach((defender) => {
      defender.memory[MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY_ASSIGN_ROOM];
    });
  }
  requestHaulers() {
    if (this.primaryRoom) {
      // PID approach
      if (this.numHaulers < this.pidDesiredHaulers) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_HAULER, {
          role: WORKERS.WORKER_HAULER,
          memory: {},
        }, REQUEST_HAULER_TTL);
      }
    }
  }
  requestReserverForMissingRooms() {
    this.missingRooms.forEach((roomID) => {
      const numReservers = this.assignedCreeps.filter((creep) => {
        return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_RESERVER &&
          creep.memory[MEMORY_ASSIGN_ROOM] === roomID;
      }).length;

      // A reserver is already assigned, don't send more
      if (numReservers) {
        return;
      }

      if (this.primaryOrgRoom && this.primaryOrgRoom.hasSpawns) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, {
          role: WORKER_RESERVER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: roomID,
          },
        }, REQUEST_MISSING_ROOMS_TTL);
      } else {
        // Bootstrapping a new colony requires another colony sending
        // creeps to claim and build a spawner
        this.getKingdom().sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, {
          role: WORKER_RESERVER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: roomID,
            [MEMORY.MEMORY_COLONY]: this.id,
          },
        }, REQUEST_MISSING_ROOMS_TTL);
      }
    });
  }
  updateOrg(trace) {
    const updateOrgTrace = trace.begin('update_org');

    this.missingRooms = _.difference(this.desiredRooms, Object.keys(Game.rooms));
    this.colonyRooms = _.difference(this.desiredRooms, this.missingRooms);

    // Rooms
    const desiredRoomIds = this.desiredRooms
    const orgRoomIds = Object.keys(this.roomMap)

    const missingOrgColonyIds = _.difference(desiredRoomIds, orgRoomIds)
    missingOrgColonyIds.forEach((id) => {
      const room = Game.rooms[id];
      if (!room) {
        return;
      }

      const orgNode = new Room(this, room, trace)
      this.roomMap[id] = orgNode;
    })

    const extraOrgColonyIds = _.difference(orgRoomIds, desiredRoomIds)
    extraOrgColonyIds.forEach((id) => {
      delete this.roomMap[id]
    })

    this.primaryOrgRoom = this.roomMap[this.primaryRoomId];

    updateOrgTrace.end();
  }
}

module.exports = Colony;
