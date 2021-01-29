const OrgBase = require('./org.base');

const MEMORY = require('./constants.memory');
const TASKS = require('./constants.tasks');
const TOPICS = require('./constants.topics');
const PRIORITIES = require('./constants.priorities');

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

    // Build list of current resources
    this.resources = this.getLabResources();
    // this.availableEffects = this.getAvailableEffects();
    // this.loadedEffects = this.getLoadedEffects();

    setupTrace.end();
  }
  update() {
    console.log(this);
  }
  process() {
    // this.sendHaulRequests()
  }
  toString() {
    return `---- Booster: Id: ${this.labs[0].id}, `; // +
    // `Loaded Effects: ${JSON.stringify(Object.keys(this.loadedEffects))}, ` +
    // `Avil. Effects: ${JSON.stringify(Object.keys(this.availableEffects))}`;
  }
  updateStats(prepared, toUnLoad, toLoad) {
    const stats = this.getStats();
    stats.colonies[this.getColony().id].booster = {
      prepared: prepared.length,
      toUnload: toUnLoad.length,
      toLoad: toLoad.length,
    };
  }
  getAssignedCreeps() {
    const labIds = this.labs.map((creep) => {
return creep.id;
});


    return this.getRoom().getCreeps().filter((creep) => {
      const pickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
      if (labIds.indexOf(pickup) != -1) {
        return true;
      }

      const dropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
      if (labIds.indexOf(dropoff) != -1) {
        return true;
      }

      return false;
    });
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
    console.log('getLoaddedEffects', JSON.stringify(this.resources));
    return this.getEffects(this.resources);
  }
  getAvailableEffects() {
    const availableResources = this.getRoom().getReserveResources(true);
    return this.getEffects(availableResources);
  }
  getDesiredEffects() {
    console.log('getting desired affects');

    const desiredEffects = {};
    const allEffects = this.getEffects();

    let request = null;
    while (request = this.getNextRequest(TOPICS.BOOST_PREP)) {
      console.log('request', JSON.stringify(request));

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
  sendHaulRequests() {
    const loadedEffects = this.getLoadedEffects();
    const desiredEffects = this.getDesiredEffects();
    const reserveResources = this.getRoom().getReserveResources(true);

    const loadedNames = Object.keys(loadedEffects);
    const desiredNames = Object.keys(desiredEffects);
    const preparedNames = _.intersection(loadedNames, desiredNames);
    const needToUnload = _.difference(loadedNames, preparedNames);
    const needToLoad = _.difference(desiredNames, preparedNames);

    console.log('booster', JSON.stringify(loadedNames), JSON.stringify(desiredNames),
      JSON.stringify(preparedNames), JSON.stringify(needToUnload), JSON.stringify(needToLoad),
      JSON.stringify(desiredEffects), JSON.stringify(loadedEffects));
    console.log('lab resources', JSON.stringify(this.resources));
    console.log('room resource', JSON.stringify(reserveResources));

    const assignedCreeps = this.getAssignedCreeps();
    if (assignedCreeps.length) {
      this.updateStats(preparedNames, needToUnload, needToLoad);
      return;
    }

    if (needToLoad.length > 0 && needToUnload.length > 0) {
      const toUnload = needToUnload.pop();
      if (toUnload) {
        const effect = loadedEffects[toUnload];
        const compound = effect.compounds[0];

        const pickup = this.getLabByResource(compound.name);
        if (!pickup) {
          console.log('No pickup for already loaded compound', compound.name);
          return;
        }

        const dropoff = this.getRoom().getReserveStructureWithRoomForResource(compound.name);
        if (!dropoff) {
          console.log('No dropoff for already loaded compound', compound.name);
          return;
        }

        const details = {
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
          [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
          [MEMORY.MEMORY_HAUL_AMOUNT]: pickup.store.getUsedCapacity(compound.name),
        };

        console.log('boost unload', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

        // this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details);
      }
    } else if (needToLoad.length > 0) {
      const toLoad = needToLoad.pop();
      if (toLoad) {
        console.log('toload', toLoad, JSON.stringify(desiredEffects));
        const effect = desiredEffects[toLoad];

        // Refactor this to a a function that further filters a set of effects
        const compound = effect.compounds.reduce((selected, compound) => {
          if (reserveResources[compound.name] > 400) {
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
          // TODO request terminal transfer
          console.log('No local compound found', JSON.stringify(effect));
          return;
        }

        const emptyLabs = this.getEmptyLabs();
        if (emptyLabs.length === 0) {
          console.log('No destination for available compound', compound.name);
          return;
        }

        const pickup = this.getRoom().getReserveStructureWithMostOfAResource(compound.name, true);
        if (!pickup) {
          console.log('No pickup for available compound', compound.name);
          return;
        }

        const details = {
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
          [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
          [MEMORY.MEMORY_HAUL_DROPOFF]: emptyLabs[0].id,
          [MEMORY.MEMORY_HAUL_AMOUNT]: 400,
        };

        console.log('boost load', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

        // this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details);
      }
    } else if (preparedNames.length > 0) {
      preparedNames.forEach((effectName) => {
        const effect = loadedEffects[effectName];
        const compound = effect.compounds[0];

        const pickup = this.getRoom().getReserveStructureWithMostOfAResource(compound.name, true);
        const lab = this.getLabByResource(compound.name);

        const currentEnergy = lab.store.getUsedCapacity(RESOURCE_ENERGY);
        if (currentEnergy < 500) {
          const details = {
            [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
            [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
            [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
            [MEMORY.MEMORY_HAUL_AMOUNT]: 2000 - currentEnergy,
          };

          console.log('boost load', PRIORITIES.HAUL_BOOST, JSON.stringify(details));

          // this.sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details);
        }
      });
    }

    this.updateStats(preparedNames, needToUnload, needToLoad);
  }
}

module.exports = Booster;
