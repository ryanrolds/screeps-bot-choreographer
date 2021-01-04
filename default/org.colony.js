const Room = require('./org.room');
const Spawner = require('./org.spawner');
const OrgBase = require('./org.base');
const Topics = require('./lib.topics');
const Pid = require('./lib.pid');

const MEMORY = require('./constants.memory');
const WORKERS = require('./constants.creeps');

const {MEMORY_ASSIGN_ROOM, MEMORY_ROLE, MEMORY_COLONY} = require('./constants.memory');
const {TOPIC_SPAWN, TOPIC_DEFENDERS, TOPIC_HAUL_TASK} = require('./constants.topics');
const {WORKER_CLAIMER, WORKER_DEFENDER} = require('./constants.creeps');
const {PRIORITY_CLAIMER, PRIORITY_DEFENDER, PRIORITY_HAULER} = require('./constants.priorities');

const MAX_DEFENDERS = 1;

class Colony extends OrgBase {
  constructor(parent, colony) {
    super(parent, colony.id);

    this.topics = new Topics();

    this.primaryRoomId = colony.primary;
    this.primaryRoom = Game.rooms[this.primaryRoomId];
    this.desiredRooms = colony.rooms;
    this.missingRooms = _.difference(this.desiredRooms, Object.keys(Game.rooms));
    this.colonyRooms = _.difference(this.desiredRooms, this.missingRooms);

    this.assignedCreeps = _.filter(parent.getCreeps(), (creep) => {
      return creep.memory[MEMORY.MEMORY_COLONY] === this.id;
    });

    this.builds = [];

    this.rooms = this.colonyRooms.reduce((rooms, id) => {
      if (Game.rooms[id]) {
        rooms.push(new Room(this, Game.rooms[id]));
      }

      return rooms;
    }, []);

    this.primaryOrgRoom = _.find(this.rooms, {id: this.primaryRoomId});

    this.spawns = this.rooms.reduce((spawns, room) => {
      const roomSpawns = room.getSpawns();
      roomSpawns.forEach((spawn) => {
        spawns.push(new Spawner(this, spawn));
      });

      return spawns;
    }, []);

    this.availableSpawns = this.spawns.filter((spawner) => {
      return !spawner.getSpawning();
    });

    this.defenders = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKER_DEFENDER &&
        creep.memory[MEMORY_COLONY] === this.id;
    });

    this.numCreeps = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_COLONY] === this.id;
    }).length;

    this.numHaulers = _.filter(this.assignedCreeps, (creep) => {
      return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_HAULER &&
        creep.memory[MEMORY_COLONY] === this.id &&
        creep.ticksToLive > 100;
    }).length;

    if (this.primaryRoom) {
      // PIDS
      this.haulerSetpoint = this.desiredRooms.length;
      Pid.setup(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS, this.haulerSetpoint, 0.1, 0.00009, 0);
    }
  }
  getColony() {
    return this;
  }
  getRoom() {
    throw new Error('a colony is not a room');
  }
  getRoomByID(roomId) {
    return _.find(this.rooms, (room) => {
      return room.id == roomId;
    });
  }
  getCreeps() {
    return this.assignedCreeps;
  }
  update() {
    console.log(this);

    this.missingRooms.forEach((roomID) => {
      const numClaimers = _.filter(this.assignedCreeps, (creep) => {
        return creep.memory[MEMORY_ROLE] == WORKERS.WORKER_CLAIMER &&
          creep.memory[MEMORY_ASSIGN_ROOM] === roomID;
      }).length;

      // A claimer already assigned, don't send more
      if (numClaimers) {
        return;
      }

      if (this.spawns.length) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, {
          role: WORKER_CLAIMER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: roomID,
          },
        });
      } else {
        // Bootstrapping a new colony requires another colony sending
        // creeps to claim and build a spawner
        this.getParent().sendRequest(TOPIC_SPAWN, PRIORITY_CLAIMER, {
          role: WORKER_CLAIMER,
          memory: {
            [MEMORY_ASSIGN_ROOM]: roomID,
          },
        });
      }
    });

    this.rooms.forEach((room) => {
      room.update();
    });

    this.spawns.forEach((spawn) => {
      spawn.update();
    });
  }
  process() {
    // Check intra-colony requests for defenders
    const request = this.getNextRequest(TOPIC_DEFENDERS);
    if (request) {
      console.log('DEFENDER REQUEST', JSON.stringify(request));

      const neededDefenders = MAX_DEFENDERS - this.defenders.length;
      if (neededDefenders > 0) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, request.details);
      }

      // Order existing defenders to the room
      this.defenders.forEach((defender) => {
        defender.memory[MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY_ASSIGN_ROOM];
      });
    }

    // Fraction of num haul tasks
    const numHaulTasks = this.getTopicLength(TOPIC_HAUL_TASK);
    this.pidDesiredHaulers = 0;
    if (this.primaryRoom) {
      // PID approach
      this.pidDesiredHaulers = Pid.update(this.primaryRoom.memory, MEMORY.PID_PREFIX_HAULERS, numHaulTasks, Game.time);
      if (this.numHaulers <= this.pidDesiredHaulers) {
        this.sendRequest(TOPIC_SPAWN, PRIORITY_HAULER, {
          role: WORKERS.WORKER_HAULER,
          memory: {},
        });
      }
    }

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
      return 0;
    }

    return this.primaryOrgRoom.getReserveStructureWithMostOfAResource(resource);
  }
  updateStats() {
    const colonyStats = {
      numHaulers: this.numHaulers,
      haulerSetpoint: this.haulerSetpoint,
      pidDesiredHaulers: this.pidDesiredHaulers,
      rooms: {},
    };
    colonyStats.topics = this.topics.getCounts();

    const stats = this.getStats();
    stats.colonies[this.id] = colonyStats;
  }
}

module.exports = Colony;
