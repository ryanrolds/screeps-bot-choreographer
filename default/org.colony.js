const Room = require('./org.room');
const Spawner = require('./org.spawner');
const OrgBase = require('./org.base');
const Topics = require('./lib.topics');
const Pid = require('./lib.pid');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const MEMORY = require('./constants.memory');
const WORKERS = require('./constants.creeps');
const {creepIsFresh} = require('./behavior.commute');

const {MEMORY_ASSIGN_ROOM, MEMORY_ROLE, MEMORY_COLONY} = require('./constants.memory');
const {TOPIC_SPAWN, TOPIC_DEFENDERS, TOPIC_HAUL_TASK} = require('./constants.topics');
const {WORKER_RESERVER, WORKER_DEFENDER} = require('./constants.creeps');
const {PRIORITY_CLAIMER, PRIORITY_DEFENDER, PRIORITY_HAULER} = require('./constants.priorities');

const MAX_DEFENDERS = 3;
const REQUEST_MISSING_ROOMS_TTL = 200;
const REQUEST_HAULER_TTL = 75;
const REQUEST_DEFENDER_TTL = 100;

class Colony extends OrgBase {
  constructor(parent, colony, trace) {
    super(parent, colony.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.topics = new Topics();

    this.primaryRoomId = colony.primary;
    this.desiredRooms = colony.rooms;

    this.primaryRoom = Game.rooms[this.primaryRoomId];

    if (this.primaryRoom) {
      Pid.setup(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS, 1, 0.15, 0.00009, 0);
    }

    this.doRequestReserversForMissingRooms = doEvery(REQUEST_MISSING_ROOMS_TTL)(() => {
      this.requestReserverForMissingRooms();
    })

    this.doRequestHaulers = doEvery(REQUEST_HAULER_TTL)(() => {
      this.requestHaulers();
    })

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = this.trace.begin('update')

    // was constructor
    if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
      this.topics.reset();
    }

    this.missingRooms = _.difference(this.desiredRooms, Object.keys(Game.rooms));
    this.colonyRooms = _.difference(this.desiredRooms, this.missingRooms);

    this.assignedCreeps = _.filter(this.getParent().getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_COLONY] === this.id;
    });
    this.numCreeps = this.assignedCreeps.length

    this.defenders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKER_DEFENDER &&
        creep.memory[MEMORY_COLONY] === this.id;
    });

    this.haulers = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_HAULER &&
        creep.memory[MEMORY_COLONY] === this.id &&
        creepIsFresh(creep);
    });

    this.numHaulers = this.haulers.length;

    // TODO update every X ticks
    this.avgHaulerCapacity = _.reduce(this.haulers, (total, hauler) => {
      return total + hauler.store.getCapacity();
    }, 0) / this.haulers.length;;

    this.roomMap = [];
    this.rooms = this.colonyRooms.reduce((rooms, id) => {
      if (Game.rooms[id]) {
        const room = new Room(this, Game.rooms[id], updateTrace);
        this.roomMap[id] = room;
        rooms.push(room);
      }

      return rooms;
    }, []);

    this.primaryOrgRoom = _.find(this.rooms, {id: this.primaryRoomId});

    this.spawns = this.rooms.reduce((spawns, room) => {
      const roomSpawns = room.getSpawns();
      roomSpawns.forEach((spawn) => {
        spawns.push(new Spawner(this, spawn, updateTrace));
      });

      return spawns;
    }, []);

    this.availableSpawns = this.spawns.filter((spawner) => {
      return !spawner.getSpawning();
    });
    // was constructor end

    console.log(this);

    if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
      this.requestReserverForMissingRooms();
    } else {
      this.doRequestReserversForMissingRooms();
    }

    this.rooms.forEach((room) => {
      room.update();
    });

    this.spawns.forEach((spawn) => {
      spawn.update();
    });

    // Check intra-colony requests for defenders
    const request = this.getNextRequest(TOPIC_DEFENDERS);
    if (request) {
      this.handleDefenderRequest(request)
    }

    if (this.primaryOrgRoom.hasStorage) {
      if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
        this.requestHaulers();
      } else {
        this.doRequestHaulers();
      }
    }

    updateTrace.end();
  }
  process() {
    this.updateStats();

    this.rooms.forEach((room) => {
      room.process();
    });

    this.spawns.forEach((spawn) => {
      spawn.process();
    });
  }
  toString() {
    return `** Colony - ID: ${this.id}, #Rooms: ${this.rooms.length}, #Missing: ${this.missingRooms.length}, ` +
      `#Haulers: ${this.numHaulers}, #Spawners: ${this.spawns.length}, ` +
      `#AvailableSpawners: ${this.availableSpawns.length}, #Defenders: ${this.defenders.length}`;
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
  sendRequest(topic, priority, request) {
    this.topics.addRequest(topic, priority, request);
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
    const colonyStats = {
      numHaulers: this.numHaulers,
      haulerSetpoint: this.haulerSetpoint,
      pidDesiredHaulers: this.pidDesiredHaulers,
      rooms: {},
      booster: {},
      spawner: {},
    };
    colonyStats.topics = this.topics.getCounts();

    const stats = this.getStats();
    stats.colonies[this.id] = colonyStats;
  }
  handleDefenderRequest(request) {
    console.log('DEFENDER REQUEST', JSON.stringify(request));

    const neededDefenders = MAX_DEFENDERS - this.defenders.length;
    if (neededDefenders > 0) {
      // If the colony has spawners and is off sufficient size spawn own defenders,
      // otherwise ask for help from other colonies
      if (this.spawns.length && (this.primaryRoom && this.primaryRoom.controller.level > 3)) {
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
    // Fraction of num haul tasks
    const numHaulTasks = this.getTopicLength(TOPIC_HAUL_TASK);
    this.pidDesiredHaulers = 0;
    if (this.primaryRoom) {
      // PID approach
      this.pidDesiredHaulers = Pid.update(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS,
        numHaulTasks, Game.time);
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
      const numReservers = _.filter(this.assignedCreeps, (creep) => {
        return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_RESERVER &&
          creep.memory[MEMORY_ASSIGN_ROOM] === roomID;
      }).length;

      // A reserver is already assigned, don't send more
      if (numReservers) {
        return;
      }

      if (this.spawns.length) {
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
}

module.exports = Colony;
