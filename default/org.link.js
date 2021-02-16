const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const {doEvery} = require('./lib.scheduler');

const {TOPIC_ROOM_LINKS} = require('./constants.topics');

const UPDATE_LINK_TTL = 50;

const REQUEST_ENERGY_TTL = 5;
const REQUEST_HAUL_TTL = 5;

class Link extends OrgBase {
  constructor(parent, link, trace) {
    super(parent, link.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.link = link;


    this.isNearRC = false;
    this.isNearSource = false;
    this.isNearStorage = false;
    this.fullness = 0;
    this.updateLink = doEvery(UPDATE_LINK_TTL)(() => {
      // Check proximity to static locations
      this.isNearRC = link.pos.findInRange(FIND_MY_STRUCTURES, 5, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_CONTROLLER;
        },
      }).length > 0;

      this.isNearSource = link.pos.findInRange(FIND_SOURCES, 2).length > 0;

      this.isNearStorage = link.pos.findInRange(FIND_MY_STRUCTURES, 2, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_STORAGE;
        },
      }).length > 0;
    });

    this.doRequestEnergy = doEvery(REQUEST_ENERGY_TTL)(() => {
      this.requestEnergy();
    });

    this.haulersWithTask = [];
    this.doRequestHaul = doEvery(REQUEST_HAUL_TTL)(() => {
      this.requestHaul();
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    const link = this.link = Game.getObjectById(this.id);
    if (!link) {
      console.log(`game object for link ${this.id} not found`);
      updateTrace.end();
      return;
    }

    this.fullness = link.store.getUsedCapacity(RESOURCE_ENERGY) / link.store.getCapacity(RESOURCE_ENERGY);

    this.updateLink(updateTrace);

    //console.log(this);

    this.doRequestEnergy();
    this.doRequestHaul();

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    if (!this.link) {
      processTrace.end();
      return;
    }

    // If near source or storage and has at least 50%
    if (this.isNearStorage && this.fullness > 0.03) {
      // Check requests
      const request = this.getNextRequest(TOPIC_ROOM_LINKS);
      if (request && request.details.REQUESTER_ID != this.id) {
        const requester = Game.getObjectById(request.details.REQUESTER_ID);
        this.link.transferEnergy(requester, request.details.AMOUNT);
      }
    }

    processTrace.end();
  }
  toString() {
    return `---- Link - ID: ${this.id}, NearStorage: ${this.isNearStorage}, ` +
      `NearSource: ${this.isNearSource}, NearRC: ${this.isNearRC}, Fullness: ${this.fullness}, ` +
      `CreepsWithTask: ${this.haulersWithTask}`;
  }
  requestEnergy() {
    if (!this.isNearRC || this.fullness >= 0.25) {
      return;
    }

    // Request enough energy to fill
    this.sendRequest(TOPIC_ROOM_LINKS, this.fullness, {
      REQUESTER_ID: this.id,
      REQUESTER_ROOM: this.link.room.id,
      AMOUNT: this.link.store.getFreeCapacity(RESOURCE_ENERGY),
    }, REQUEST_ENERGY_TTL);
  }
  requestHaul() {
    const creeps = this.getColony().getCreeps();
    this.haulersWithTask = creeps.filter((creep) => {
      const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
      const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
      return task === TASKS.TASK_HAUL && dropoff === this.id;
    }).length;

    if (this.haulersWithTask.length) {
      return;
    }

    const roomEnergy = this.getRoom().getAmountInReserve(RESOURCE_ENERGY);
    if (!this.isNearStorage || this.fullness >= 1 || roomEnergy <= 5000) {
      return;
    }

    const reserve = this.parent.getRoom().getReserveStructureWithMostOfAResource(RESOURCE_ENERGY);
    if (!reserve) {
      return;
    }

    const details = {
      [MEMORY.TASK_ID]: `ll-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: this.link.store.getFreeCapacity(RESOURCE_ENERGY),
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.id,
    };

    this.sendRequest(TOPICS.HAUL_CORE_TASK, 1, details, REQUEST_HAUL_TTL);
  }
}

module.exports = Link;
