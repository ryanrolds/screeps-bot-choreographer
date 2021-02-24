const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');
const {doEvery} = require('./lib.scheduler');

const MIN_COMPOUND = 500;
const MAX_COMPOUND = 1500;
const MIN_ENERGY = 1000;
const MAX_ENERGY = 1000;


const UPDATE_PREPARE_TTL = 5;
const REQUEST_UNLOAD_TTL = 5;
const REQUEST_LOAD_TTL = 5;
const REQUEST_ENERGY_TTL = 10;
const REQUEST_LOW_LABS_UNLOAD_TTL = 10;

class Compound {
  constructor(name, effect, bonus) {
    this.name = name;
    this.effect = effect;
    this.bonus = bonus;
  }
}

class Effect {
  constructor(name, part, compounds = [], bonus) {
    this.name = name;
    this.part = part;
    this.compounds = compounds;
  }
}

class Booster extends OrgBase {
  constructor(parent, labs, trace) {
    super(parent, labs[0].id, trace);

    const setupTrace = this.trace.begin('constructor');

    this.labs = labs;
    this.prepare = {};

    // Build list of current resources
    this.resources = this.getLabResources();
    this.availableEffects = this.getAvailableEffects();
    this.loadedEffects = this.getLoadedEffects();
    this.creepBoostPosition = null;

    this.doUpdatePrepare = doEvery(UPDATE_PREPARE_TTL)(() => {
      this.updatePrepare();
    });

    this.doRequestClearLowLabs = doEvery(REQUEST_LOW_LABS_UNLOAD_TTL)(() => {
      this.requestClearLowLabs();
    });

    this.doRequestEnergyForLabs = doEvery(REQUEST_ENERGY_TTL)(() => {
      this.requestEnergyForLabs();
    });

    this.doRequestUnloadOfLabs = doEvery(REQUEST_UNLOAD_TTL)((loadedEffects, couldUnload) => {
      this.requestUnloadOfLabs(loadedEffects, couldUnload);
    });

    this.doRequestMaterialsForLabs = doEvery(REQUEST_LOAD_TTL)((desiredEffects, needToLoad) => {
      this.requestMaterialsForLabs(desiredEffects, needToLoad);
    });

    setupTrace.end();
  }
  update(trace) {
    const updateTrace = trace.begin('update');

    this.labs = this.labs.map((lab) => {
      return Game.getObjectById(lab.id);
    }).filter((lab) => {
      return lab
    });

    if (this.labs.length !== 3) {
      //console.log(`not enough labs (${this.labs.length}) to form booster`);
      updateTrace.end();
      return;
    }

    this.resources = this.getLabResources();
    this.availableEffects = this.getAvailableEffects();
    this.loadedEffects = this.getLoadedEffects();
    this.creepBoostPosition = this.getCreepBoostPosition();

    this.doUpdatePrepare();

    // console.log(this);

    updateTrace.end();
  }
  process(trace) {
    const processTrace = trace.begin('process');

    if (this.labs.length !== 3) {
      processTrace.end();
      return;
    }

    this.doRequestEnergyForLabs();

    if (Object.keys(this.prepare).length) {
      this.sendHaulRequests();
    } else {
      this.doRequestClearLowLabs();
    }

    processTrace.end();
  }
  toString() {
    return `---- Booster: Id: ${this.labs[0].id}, ` +
      `Prepare: ${JSON.stringify(this.prepare)}, ` +
      `Boost Pos: ${this.creepBoostPosition.x}, ${this.creepBoostPosition.y}, ` +
      `Loaded Effects: ${JSON.stringify(Object.keys(this.loadedEffects))}, ` +
      `Avil. Effects: ${JSON.stringify(Object.keys(this.availableEffects))}`;
  }
  updateStats(prepared, toUnLoad, toLoad) {
    const stats = this.getStats();
    stats.colonies[this.getColony().id].booster = {
      prepared: prepared.length,
      toUnload: toUnLoad.length,
      toLoad: toLoad.length,
    };
  }
  getCreepBoostPosition() {
    if (!this.labs.length) {
      return null;
    }

    const topLeft = this.labs.reduce((acc, lab) => {
      if (lab.pos.x < acc.x) {
        acc.x = lab.pos.x;
      }

      if (lab.pos.y < acc.y) {
        acc.y = lab.pos.y;
      }

      return acc;
    }, {x: 50, y: 50});

    let position = null;
    const roomId = this.getRoom().id;

    position = new RoomPosition(topLeft.x, topLeft.y, roomId);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    position = new RoomPosition(topLeft.x, topLeft.y + 1, roomId);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    position = new RoomPosition(topLeft.x + 1, topLeft.y, roomId);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    position = new RoomPosition(topLeft.x + 1, topLeft.y + 1, roomId);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    return this.labs[0].pos;
  }
  getLabByResource(resource) {
    for (let i = 0; i < this.labs.length; i++) {
      if (this.labs[i].mineralType === resource) {
        return this.labs[i];
      }
    }

    return null;
  }
  getLabResources() {
    return this.labs.reduce((acc, lab) => {
      if (lab.mineralType) {
        acc[lab.mineralType] = lab.store.getUsedCapacity(lab.mineralType);
      }

      return acc;
    }, {});
  }
  getEmptyLabs() {
    return this.labs.filter((lab) => {
      return !lab.mineralType;
    });
  }
  getEffects(availableResources = null) {
    const allEffects = {};

    Object.keys(BOOSTS).forEach((part) => {
      const resources = BOOSTS[part];
      Object.keys(resources).forEach((resource) => {
        if (availableResources && !availableResources[resource]) {
          return;
        }

        const effects = resources[resource];
        Object.keys(effects).forEach((effect) => {
          const bonus = effects[effect];

          if (!allEffects[effect]) {
            allEffects[effect] = new Effect(effect, part);
          }

          allEffects[effect].compounds.push(new Compound(resource, effect, bonus));
        });
      });
    });

    return allEffects;
  }
  getLoadedEffects() {
    return this.getEffects(this.resources);
  }
  getAvailableEffects() {
    const availableResources = this.getRoom().getReserveResources(true);
    return this.getEffects(availableResources);
  }
  getDesiredEffects() {
    const desiredEffects = {};
    const allEffects = this.getEffects();

    let request = null;
    while (request = this.getNextRequest(TOPICS.BOOST_PREP)) {
      const requestedEffects = request.details[MEMORY.PREPARE_BOOSTS];
      if (!requestedEffects) {
        continue;
      }

      requestedEffects.forEach((requested) => {
        desiredEffects[requested] = allEffects[requested];
      });
    }

    return desiredEffects;
  }
  updatePrepare() {
    this.prepare = this.getDesiredEffects();
  }
  sendHaulRequests() {
    const loadedEffects = this.getLoadedEffects();
    const desiredEffects = this.prepare;

    const loadedNames = Object.keys(loadedEffects);
    const desiredNames = Object.keys(desiredEffects);
    let preparedNames = _.intersection(loadedNames, desiredNames);

    preparedNames = preparedNames.filter((effectName) => {
      const effect = loadedEffects[effectName];
      const compound = effect.compounds[0].name;
      const lab = this.getLabByResource(compound);
      if (lab.store.getUsedCapacity(compound) < MIN_COMPOUND) {
        return false;
      }

      return true;
    });

    const emptyLabs = this.getEmptyLabs();
    const couldUnload = _.difference(loadedNames, preparedNames);
    const needToLoad = _.difference(desiredNames, preparedNames);

    // console.log('booster', this.id, JSON.stringify(loadedNames), JSON.stringify(desiredNames),
    //  JSON.stringify(preparedNames), JSON.stringify(couldUnload), JSON.stringify(needToLoad),
    //  JSON.stringify(desiredEffects), JSON.stringify(loadedEffects));

    // console.log('booster', this.getRoom().id, emptyLabs.length);
    // console.log('desired', JSON.stringify(desiredNames));
    // console.log('prepared', JSON.stringify(preparedNames));
    // console.log('couldUnload', JSON.stringify(couldUnload));
    // console.log('...needToLoad', JSON.stringify(needToLoad));

    // console.log('lab resources', JSON.stringify(this.resources));
    // console.log('room resource', JSON.stringify(reserveResources));

    const numToLoad = needToLoad.length;
    const numEmpty = emptyLabs.length;

    if (numToLoad > numEmpty) {
      const numToUnload = numToLoad - numEmpty;
      const unload = couldUnload.slice(0, numToUnload);
      this.doRequestUnloadOfLabs(loadedEffects, unload);
    }

    if (numEmpty && numToLoad) {
      const numReadyToLoad = _.min([numEmpty, numToLoad]);
      const load = needToLoad.slice(0, numReadyToLoad);
      this.doRequestMaterialsForLabs(desiredEffects, load);
    }

    this.updateStats(preparedNames, couldUnload, needToLoad);
  }
  requestClearLowLabs() {
    this.labs.forEach((lab) => {
      if (!lab.mineralType) {
        return;
      }

      if (lab.store.getUsedCapacity(lab.mineralType) > MIN_COMPOUND) {
        return;
      }

      const dropoff = this.getRoom().getReserveStructureWithRoomForResource(lab.mineralType);
      if (!dropoff) {
        //console.log('No dropoff for already loaded compound', lab.mineralType);
        return;
      }

      const details = {
        [MEMORY.TASK_ID]: `bmc-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
        [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: lab.store.getUsedCapacity(lab.mineralType),
      };

      //console.log('boost clear low', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

      this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details, REQUEST_LOW_LABS_UNLOAD_TTL);
    });
  }
  requestUnloadOfLabs(loadedEffects, couldUnload) {
    couldUnload.forEach((toUnload) => {
      const effect = loadedEffects[toUnload];
      const compound = effect.compounds[0];

      const pickup = this.getLabByResource(compound.name);
      if (!pickup) {
        //console.log('No pickup for already loaded compound', compound.name);
        return;
      }

      const assignedCreeps = this.getCreeps().filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskPickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.HAUL_TASK && taskPickup === pickup.id && resource == compound.name;
      });
      if (assignedCreeps.length) {
        return;
      }

      const dropoff = this.getRoom().getReserveStructureWithRoomForResource(compound.name);
      if (!dropoff) {
        //console.log('No dropoff for already loaded compound', compound.name);
        return;
      }

      const details = {
        [MEMORY.TASK_ID]: `bmu-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
        [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: pickup.store.getUsedCapacity(compound.name),
      };

      //console.log('boost unload', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

      this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details, REQUEST_UNLOAD_TTL);
    });
  }
  requestMaterialsForLabs(desiredEffects, needToLoad) {
    const reserveResources = this.getRoom().getReserveResources(true);

    needToLoad.forEach((toLoad) => {
      //console.log('toload', toLoad, JSON.stringify(desiredEffects));
      const effect = desiredEffects[toLoad];

      const emptyLabs = this.getEmptyLabs();
      if (emptyLabs.length === 0) {
        //console.log('No destination for available compound', compound.name);
        return;
      }
      const emptyLab = emptyLabs[0];

      const assignedCreeps = this.getCreeps().filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskDropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.HAUL_TASK && taskDropoff === emptyLab.id && resource !== RESOURCE_ENERGY;
      });
      if (assignedCreeps.length) {
        return;
      }

      // Refactor this to a a function that further filters a set of effects
      const compound = effect.compounds.reduce((selected, compound) => {
        if (reserveResources[compound.name] > MIN_COMPOUND) {
          if (!selected) {
            selected = compound;
          }

          if (effect.name != 'damage') {
            if (selected.bonus < compound.bonus) {
              selected = compound;
            }
          } else {
            if (selected.bonus > compound.bonus) {
              selected = compound;
            }
          }
        }

        return selected;
      }, null);

      if (!compound) {
        //console.log('no compound available for', toLoad);
        return;
      }

      const pickup = this.getRoom().getReserveStructureWithMostOfAResource(compound.name, true);
      if (!pickup) {
        //console.log('No pickup for available compound', compound.name);
        return;
      }

      const details = {
        [MEMORY.TASK_ID]: `brl-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
        [MEMORY.MEMORY_HAUL_DROPOFF]: emptyLab.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: pickup.store.getUsedCapacity(compound.name),
      };

      //console.log('boost load material', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

      this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details, REQUEST_LOAD_TTL);
    });
  }
  requestEnergyForLabs() {
    this.labs.forEach((lab) => {
      // Only fill lab if needed
      if (lab.store.getUsedCapacity(RESOURCE_ENERGY) >= MIN_ENERGY) {
        return;
      }

      const pickup = this.getRoom().getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, false);
      const currentEnergy = lab.store.getUsedCapacity(RESOURCE_ENERGY);
      const details = {
        [MEMORY.TASK_ID]: `bel-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: MAX_ENERGY - currentEnergy,
      };

      //console.log('boost load energy', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

      this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details, REQUEST_ENERGY_TTL);
    });
  }
}

module.exports = Booster;
