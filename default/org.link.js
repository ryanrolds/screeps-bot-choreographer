const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const featureFlags = require('./lib.feature_flags')
const {doEvery} = require('./lib.scheduler');

const {TOPIC_ROOM_LINKS} = require('./constants.topics');

const REQUEST_ENERGY_TTL = 20;
const REQUEST_HAUL_TTL = 50;

class Link extends OrgBase {
  constructor(parent, link, trace) {
    super(parent, link.id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.gameObject = link; // DEPRECATED
    this.link = link;

    this.isNearRC = link.pos.findInRange(FIND_MY_STRUCTURES, 5, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_CONTROLLER;
      },
    }).length > 0;

    this.isNearSource = link.pos.findInRange(FIND_SOURCES, 2).length > 0;

    this.doRequestEnergy = doEvery(REQUEST_ENERGY_TTL)(() => {
      this.requestEnergy();
    })

    this.doRequestHaul = doEvery(REQUEST_HAUL_TTL)((reserver) => {
      this.requestHaul(reserve);
    })

    setupTrace.end();
  }
  update() {
    const link = this.link;

    // was constructor
    this.fullness = link.store.getUsedCapacity(RESOURCE_ENERGY) / link.store.getCapacity(RESOURCE_ENERGY);

    this.isNearStorage = link.pos.findInRange(FIND_MY_STRUCTURES, 2, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_STORAGE;
      },
    }).length > 0;
    // was constructor end

    // console.log(this);

    if (this.isNearRC && this.fullness < 0.25) {
      // Request enough energy to fill
      if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
        this.requestEnergy();
      } else {
        this.doRequestEnergy();
      }
    }

    const roomEnergy = this.getRoom().getAmountInReserve(RESOURCE_ENERGY);

    if (this.isNearStorage && this.fullness < 1 && roomEnergy > 5000) {
      const reserve = this.parent.getRoom().getReserveStructureWithMostOfAResource(RESOURCE_ENERGY);
      if (reserve) {
        if (!featureFlags.getFlag(featureFlags.DO_NOT_RESET_TOPICS_EACH_TICK)) {
          this.requestHaul(reserve);
        } else {
          this.doRequestHaul(reserve)
        }
      }
    }
  }
  process() {
    // If near source or storage and has at least 50%
    if (this.isNearStorage && this.fullness > 0.03) {
      // Check requests
      const request = this.getNextRequest(TOPIC_ROOM_LINKS);
      if (request && request.details.REQUESTER_ID != this.id) {
        const requester = Game.getObjectById(request.details.REQUESTER_ID);
        this.gameObject.transferEnergy(requester, request.details.AMOUNT);
      }
    }
  }
  toString() {
    return `---- Link - ID: ${this.id}, NearStorage: ${this.isNearStorage}, ` +
      `NearSource: ${this.isNearSource}, NearRC: ${this.isNearRC}, Fullness: ${this.fullness}`;
  }
  requestEnergy() {
    this.sendRequest(TOPIC_ROOM_LINKS, this.fullness, {
      REQUESTER_ID: this.id,
      REQUESTER_ROOM: this.link.room.id,
      AMOUNT: this.link.store.getFreeCapacity(RESOURCE_ENERGY),
    }, REQUEST_ENERGY_TTL);
  }
  requestHaul(reserve) {
    const details = {
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: this.link.store.getFreeCapacity(RESOURCE_ENERGY),
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.id,
    };

    this.sendRequest(TOPICS.TOPIC_HAUL_TASK, 0.9, details, REQUEST_HAUL_TTL);
  }
}

module.exports = Link;
