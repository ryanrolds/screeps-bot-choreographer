import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as CREEPS from "./constants.creeps"
import * as PRIORITIES from "./constants.priorities"

const MIN_COMPOUND = 500;
const MAX_COMPOUND = 1500;
const MIN_ENERGY = 1000;
const MAX_ENERGY = 1000;

const REQUEST_UNLOAD_TTL = 5;
const REQUEST_LOAD_TTL = 5;
const REQUEST_ENERGY_TTL = 5;
const REQUEST_REBALANCE_TTL = 10;
const MIN_CREDITS_FOR_BOOSTS = 50000;

class Compound {
  name: string;
  effect: any;
  bonus: number;

  constructor(name, effect, bonus) {
    this.name = name;
    this.effect = effect;
    this.bonus = bonus;
  }
}

class Effect {
  name: string;
  part: string;
  compounds: Compound[];

  constructor(name: string, part: string, compounds: Compound[] = []) {
    this.name = name;
    this.part = part;
    this.compounds = compounds;
  }
}

export default class BoosterRunnable {
  id: string;
  orgRoom: OrgRoom;
  labIds: Id<StructureLab>[];
  boostPosition: RoomPosition;
  prevTime: number;

  constructor(id: string, orgRoom: OrgRoom, labIds: Id<StructureLab>[]) {
    this.id = id;
    this.orgRoom = orgRoom;
    this.labIds = labIds;

    this.prevTime = Game.time;
    this.boostPosition = this.getCreepBoostPosition();
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    let labs = this.getLabs();
    if (labs.length !== 3) {
      trace.log('not right number of labs - terminating', {num: labs.length})
      return terminate();
    }

    trace.log('booster run', {labId: labs.map(lab => lab.id)});

    const availableEffects = this.getAvailableEffects();
    const loadedEffects = this.getLoadedEffects();
    const desiredEffects = this.getDesiredEffects();

    const [needToLoad, couldUnload, emptyLabs] = this.getNeeds(loadedEffects, desiredEffects, trace);
    this.updateStats(loadedEffects, couldUnload, needToLoad, trace);

    trace.log('room status', {
      loaded: loadedEffects,
      desired: desiredEffects,
      availableEffects: availableEffects,
    });

    trace.log('booster needs', {
      labIds: this.labIds,
      needToLoad,
      couldUnload,
      emptyLabIds: emptyLabs.map(lab => lab.id),
    });

    let sleepFor = REQUEST_ENERGY_TTL;
    this.requestEnergyForLabs(trace);

    if (Object.keys(desiredEffects).length) {
      sleepFor = REQUEST_LOAD_TTL;
      this.sendHaulRequests(loadedEffects, desiredEffects, needToLoad, emptyLabs, couldUnload, trace);
    } else {
      sleepFor = REQUEST_UNLOAD_TTL;
      this.rebalanceLabs(trace);
    }

    return sleeping(sleepFor);
  }

  getLabs() {
    return this.labIds.map(labId => Game.getObjectById(labId)).filter((lab => lab));
  }

  updateStats(prepared, toUnLoad, toLoad, trace: Tracer) {
    const stats = (this.orgRoom as any).getStats();
    const colony = (this.orgRoom as any).getColony();
    if (!colony) {
      trace.log('could not find colony', {roomId: this.orgRoom.id});
      return;
    }

    const boosterStats = {
      prepared: prepared.length,
      toUnload: toUnLoad.length,
      toLoad: toLoad.length,
      boostedCreeps: (colony.getCreeps() as Creep[]).reduce((total, creep) => {
        if (_.find(creep.body, part => {return !!part.boost;})) {
          return total + 1;
        }

        return total;
      }, 0),
    };

    trace.log('updating booster stats', {boosterStats});

    stats.colonies[colony.id].booster = boosterStats;
  }

  getBoostPosition() {
    return this.boostPosition;
  }

  private getCreepBoostPosition() {
    const labs = this.getLabs();
    if (!labs.length) {
      return null;
    }

    const topLeft = labs.reduce((acc, lab) => {
      if (lab.pos.x < acc.x) {
        acc.x = lab.pos.x;
      }

      if (lab.pos.y < acc.y) {
        acc.y = lab.pos.y;
      }

      return acc;
    }, {x: 50, y: 50});

    let position = null;
    const roomId = (this.orgRoom as any).id;

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

    return labs[0].pos;
  }

  getLabByResource(resource) {
    const labs = this.getLabs();
    for (let i = 0; i < labs.length; i++) {
      if (labs[i].mineralType === resource) {
        return labs[i];
      }
    }

    return null;
  }
  getLabResources() {
    const labs = this.getLabs();
    return labs.reduce((acc, lab) => {
      if (lab.mineralType) {
        acc[lab.mineralType] = lab.store.getUsedCapacity(lab.mineralType);
      }

      return acc;
    }, {});
  }
  getEmptyLabs() {
    const labs = this.getLabs();
    return labs.filter((lab) => {
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
    const resources = this.getLabResources();
    return this.getEffects(resources);
  }
  getAvailableEffects() {
    const availableResources = this.orgRoom.getReserveResources(true);
    return this.getEffects(availableResources);
  }
  getDesiredEffects() {
    const desiredEffects = {};
    const allEffects = this.getEffects();

    let request = null;
    while (request = (this.orgRoom as any).getNextRequest(TOPICS.BOOST_PREP)) {
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
  getNeeds(loadedEffects, desiredEffects, trace: Tracer) {
    const loadedNames = Object.keys(loadedEffects);
    const desiredNames = Object.keys(desiredEffects);
    let preparedNames = _.intersection(loadedNames, desiredNames);

    preparedNames = preparedNames.filter((effectName) => {
      const effect = loadedEffects[effectName];
      const compound = effect.compounds[0].name;
      const lab = this.getLabByResource(compound);
      const currentAmount = lab.store.getUsedCapacity(compound);
      if (currentAmount < MIN_COMPOUND) {
        trace.log('not enough of compound', {compound, effectName, currentAmount})
        return false;
      }

      return true;
    });

    const needToLoad = _.difference(desiredNames, preparedNames);
    const couldUnload = _.difference(loadedNames, preparedNames);
    const emptyLabs = this.getEmptyLabs();

    return [needToLoad, couldUnload, emptyLabs]
  }

  sendHaulRequests(loadedEffects, desiredEffects, needToLoad, emptyLabs, couldUnload, trace: Tracer) {
    const numToLoad = needToLoad.length;
    const numEmpty = emptyLabs.length;

    if (numEmpty && numToLoad) {
      const numReadyToLoad = _.min([numEmpty, numToLoad]);
      const load = needToLoad.slice(0, numReadyToLoad);
      this.requestMaterialsForLabs(desiredEffects, load, trace);
    }

    if (numToLoad > numEmpty) {
      const numToUnload = numToLoad - numEmpty;
      const unload = couldUnload.slice(0, numToUnload);
      this.requestUnloadOfLabs(loadedEffects, unload, trace);
    }
  }
  rebalanceLabs(trace: Tracer) {
    const labs = this.getLabs();
    labs.forEach((lab) => {
      if (!lab.mineralType) {
        trace.log('lab has no mineral loaded', {labId: lab.id});
        return;
      }

      const currentAmount = lab.store.getUsedCapacity(lab.mineralType);
      let amount = 0;
      if (currentAmount < MIN_COMPOUND) {
        trace.log('lab is below min: unload it', {labId: lab.id, resource: lab.mineralType});
        amount = currentAmount
      } else if (currentAmount > MAX_COMPOUND) {
        trace.log('lab is above min: return some', {labId: lab.id, resource: lab.mineralType});
        amount = currentAmount - MAX_COMPOUND;
      }

      if (amount) {
        const dropoff = this.orgRoom.getReserveStructureWithRoomForResource(lab.mineralType);
        if (!dropoff) {
          trace.log('no dropoff for already loaded compound', {resource: lab.mineralType});
          return;
        }

        const details = {
          [MEMORY.TASK_ID]: `bmc-${this.id}-${Game.time}`,
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
          [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
          [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
        };

        trace.log('boost clear low', {priority: PRIORITIES.HAUL_BOOST, details});

        (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST,
          details, REQUEST_REBALANCE_TTL);
      }
    });
  }
  requestUnloadOfLabs(loadedEffects, couldUnload, trace: Tracer) {
    couldUnload.forEach((toUnload) => {
      const effect = loadedEffects[toUnload];
      const compound = effect.compounds[0];

      const pickup = this.getLabByResource(compound.name);
      if (!pickup) {
        trace.log('no pickup for already loaded compound', {resource: compound.name});
        return;
      }

      const assignedCreeps = this.orgRoom.getCreeps().filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskPickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.HAUL_TASK && taskPickup === pickup.id && resource == compound.name;
      });
      if (assignedCreeps.length) {
        trace.log('creep already unloading', {resource: compound.name});
        return;
      }

      const dropoff = this.orgRoom.getReserveStructureWithRoomForResource(compound.name);
      if (!dropoff) {
        trace.log('no dropoff for already loaded compound', {resource: compound.name});
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

      trace.log('boost unload', {priority: PRIORITIES.HAUL_BOOST, details});

      (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.UNLOAD_BOOST,
        details, REQUEST_UNLOAD_TTL);
    });
  }
  requestMaterialsForLabs(desiredEffects, needToLoad, trace: Tracer) {
    const reserveResources = this.orgRoom.getReserveResources(true);

    needToLoad.forEach((toLoad) => {
      trace.log('need to load', {toLoad})
      const effect = desiredEffects[toLoad];
      if (!effect) {
        trace.log('not able to find desired effect', {toLoad});
        return;
      }

      const emptyLabs = this.getEmptyLabs();
      if (emptyLabs.length === 0) {
        trace.log('no destination for available compound', {toLoad});
        return;
      }
      const emptyLab = emptyLabs[0];

      const assignedCreeps = this.orgRoom.getCreeps().filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskDropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.HAUL_TASK && taskDropoff === emptyLab.id && resource !== RESOURCE_ENERGY;
      });
      if (assignedCreeps.length) {
        trace.log('creep already loading', {toLoad});
        return;
      }

      // Refactor this to a a function that further filters a set of effects
      const compound = effect.compounds.reduce((selected, compound) => {
        if (reserveResources[compound.name] >= MIN_COMPOUND) {
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
        trace.log('no compound available for', {toLoad});
        return;
      }

      const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(compound.name, true);
      if (!pickup) {
        trace.log('no pickup for available compound', {resource: compound.name});
        return;
      }

      const details = {
        [MEMORY.TASK_ID]: `brl-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
        [MEMORY.MEMORY_HAUL_DROPOFF]: emptyLab.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: MAX_COMPOUND,
      };

      trace.log('boost load material', {priority: PRIORITIES.HAUL_BOOST, details});

      (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details, REQUEST_LOAD_TTL);
    });
  }
  requestEnergyForLabs(trace: Tracer) {
    const labs = this.getLabs();
    labs.forEach((lab) => {
      // Only fill lab if needed
      if (lab.store.getUsedCapacity(RESOURCE_ENERGY) >= MIN_ENERGY) {
        trace.log('lab has energy', {labId: lab.id});
        return;
      }

      const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, false);
      const currentEnergy = lab.store.getUsedCapacity(RESOURCE_ENERGY);
      const details = {
        [MEMORY.TASK_ID]: `bel-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: MAX_ENERGY - currentEnergy,
      };

      trace.log('boost load energy', {labId: lab.id, priority: PRIORITIES.HAUL_BOOST, details});

      (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_BOOST, details, REQUEST_ENERGY_TTL);
    });
  }
}
