import * as MEMORY from '../constants/memory';
import * as PRIORITIES from '../constants/priorities';
import * as TASKS from '../constants/tasks';
import * as TOPICS from '../constants/topics';
import {Tracer} from '../lib/tracing';
import {Base, BaseThreadFunc, getStoredResources, getStructureForResource, getStructureWithResource, ResourceCounts, threadBase} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, sleeping, terminate} from '../os/process';
import {getBaseDistributorTopic} from './logistics';

const MIN_COMPOUND = 500;
const MAX_COMPOUND = 2000;
const MIN_ENERGY = 1000;
const MAX_ENERGY = 2000;

const REQUEST_UNLOAD_TTL = 5;
const REQUEST_LOAD_TTL = 5;
const REQUEST_ENERGY_TTL = 5;
const REQUEST_REBALANCE_TTL = 10;
const UPDATE_ROOM_BOOSTER_INTERVAL = 5;

export function getBaseBoostTopic(base: Base): string {
  return `base_${base.id}_room_boosts`;
}

export type BoosterDetails = {
  baseId: string;
  position: RoomPosition;
  allEffects: EffectSet;
  storedEffects: EffectSet;
  labsByResource: LabsByResource;
  labsByAction: LabsByAction;
}

export type Reaction = {
  inputA: ResourceConstant,
  inputB: ResourceConstant,
  output: ResourceConstant,
  priority?: number,
};

export type ReactionMap = Map<ResourceConstant, Reaction>;

export class Compound {
  name: ResourceConstant;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  effect: any;
  bonus: number;

  constructor(name, effect, bonus) {
    this.name = name;
    this.effect = effect;
    this.bonus = bonus;
  }
}

export class Effect {
  name: string;
  part: string;
  compounds: Compound[];

  constructor(name: string, part: string, compounds: Compound[] = []) {
    this.name = name;
    this.part = part;
    this.compounds = compounds;
  }
}

export type EffectSet = Map<string, Effect>;
export type LabsByResource = Map<MineralConstant | MineralCompoundConstant, StructureLab>;
export type ResourceByLabs = Map<StructureLab, MineralConstant | MineralCompoundConstant>;
export type LabsByAction = Map<string, StructureLab[]>;

export default class BoosterRunnable {
  id: string;
  baseId: string;
  labIds: Id<StructureLab>[];
  boostPosition: RoomPosition;
  allEffects: EffectSet;

  threadUpdateBoosters: BaseThreadFunc;

  constructor(id: string, baseId: string, labIds: Id<StructureLab>[]) {
    this.id = id;
    this.baseId = baseId;
    this.labIds = labIds;
    this.allEffects = null;

    this.boostPosition = this.getCreepBoostPosition();
    this.threadUpdateBoosters = threadBase('update_room_booster', UPDATE_ROOM_BOOSTER_INTERVAL)(this.updateBoosters.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('booster_run');

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('Base not found', {baseId: this.baseId});
      trace.end();
      return terminate();
    }

    const labs = this.getLabs();
    if (labs.length !== 3) {
      trace.info('not right number of labs - terminating', {num: labs.length});
      trace.end();
      return terminate();
    }

    trace.info('booster run', {labId: labs.map((lab) => lab.id)});

    const resourceEnd = trace.startTimer('resource');
    const loadedEffects = this.getLoadedEffects();
    const desiredEffects = this.getDesiredEffects(kernel);
    resourceEnd();

    const [needToLoad, couldUnload, emptyLabs] = this.getNeeds(loadedEffects, desiredEffects, trace);

    trace.info('room status', {
      loaded: loadedEffects,
      desired: desiredEffects,
    });

    trace.info('booster needs', {
      labIds: this.labIds,
      needToLoad,
      couldUnload,
      emptyLabIds: emptyLabs.map((lab) => lab.id),
    });

    let sleepFor = REQUEST_ENERGY_TTL;
    this.requestEnergyForLabs(kernel, base, trace);
    this.threadUpdateBoosters(trace, kernel, base);

    if (desiredEffects.size) {
      sleepFor = REQUEST_LOAD_TTL;
      this.sendHaulRequests(kernel, base, loadedEffects, needToLoad, emptyLabs, couldUnload, trace);
    } else {
      sleepFor = REQUEST_UNLOAD_TTL;
      this.rebalanceLabs(kernel, base, trace);
    }

    trace.end();

    return sleeping(sleepFor);
  }

  getLabs() {
    return this.labIds.map((labId) => Game.getObjectById(labId)).filter(((lab) => lab));
  }

  updateBoosters(trace: Tracer, kernel: Kernel, base: Base) {
    const resourceEnd = trace.startTimer('resources');
    const allEffects = this.getCompoundByEffects();
    const storedEffects = this.getAvailableEffects(kernel, base);
    const labsByResource = this.getLabsByResource();
    const labsByAction = this.getLabsByAction();
    resourceEnd();

    const details: BoosterDetails = {
      baseId: this.baseId,
      position: this.boostPosition,
      allEffects,
      storedEffects,
      labsByResource,
      labsByAction: labsByAction,
    };

    trace.info('publishing room boosts', {
      baseId: this.baseId,
      position: this.boostPosition,
      labsByResource: _.reduce(Array.from(labsByResource.values()), (labs, lab: StructureLab) => {
        labs.set(lab.id, lab.mineralType);
        return labs;
      }, new Map<Id<StructureLab>, MineralConstant | MineralCompoundConstant>()),
      availableEffects: storedEffects,
    });

    kernel.getTopics().addRequest(getBaseBoostTopic(base), 1, details, UPDATE_ROOM_BOOSTER_INTERVAL);
  }

  getBoostPosition() {
    return this.boostPosition;
  }

  private getCreepBoostPosition() {
    const labs = this.getLabs();
    if (!labs.length) {
      return null;
    }

    const roomName = labs[0].room.name;

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
    position = new RoomPosition(topLeft.x, topLeft.y, roomName);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    position = new RoomPosition(topLeft.x, topLeft.y + 1, roomName);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    position = new RoomPosition(topLeft.x + 1, topLeft.y, roomName);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    position = new RoomPosition(topLeft.x + 1, topLeft.y + 1, roomName);
    if (position.lookFor(LOOK_STRUCTURES).filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    }).length === 0) {
      return position;
    }

    return labs[0].pos;
  }

  getLabsByAction(): LabsByAction {
    return this.getLabs().reduce((acc, lab) => {
      if (lab.mineralType) {
        const action = this.allEffects.get(lab.mineralType);
        if (!acc.has(action.name)) {
          acc.set(action.name, []);
        }

        acc.get(action.name).push(lab);
      }

      return acc;
    }, new Map());
  }

  // @deprecated - use getLabsByAction()
  getLabsByResource(): LabsByResource {
    const labs = this.getLabs();
    return labs.reduce((acc, lab) => {
      if (lab.mineralType) {
        acc.set(lab.mineralType, lab);
      }

      return acc;
    }, new Map());
  }

  // @deprecated - use getLabsByAction()
  getLabByResource(resource) {
    const labs = this.getLabs();
    for (let i = 0; i < labs.length; i++) {
      if (labs[i].mineralType === resource) {
        return labs[i];
      }
    }

    return null;
  }

  getLabResources(): ResourceCounts {
    const labs = this.getLabs();
    return labs.reduce((acc, lab) => {
      if (lab.mineralType) {
        acc.set(lab.mineralType, lab.store.getUsedCapacity(lab.mineralType));
      }

      return acc;
    }, new Map());
  }

  getEmptyLabs() {
    const labs = this.getLabs();
    return labs.filter((lab) => {
      return !lab.mineralType;
    });
  }

  // Get compounds by effects
  getCompoundByEffects(availableResources: ResourceCounts = null): EffectSet {
    // If we are after all events and they are already cached, then return the cache
    if (!availableResources && this.allEffects) {
      return this.allEffects;
    }

    const allEffects: EffectSet = new Map();

    Object.keys(BOOSTS).forEach((part) => {
      const resources = BOOSTS[part];
      Object.keys(resources).forEach((resource: ResourceConstant) => {
        if (availableResources && !availableResources.get(resource)) {
          return;
        }

        const effects = resources[resource];
        Object.keys(effects).forEach((effect) => {
          const bonus = effects[effect];

          if (!allEffects.has(effect)) {
            allEffects.set(effect, new Effect(effect, part));
          }

          allEffects.get(effect).compounds.push(new Compound(resource, effect, bonus));
        });
      });
    });

    // If all effects are not already cached, cache them.
    // Do not cache if we are checking against available resources.
    if (!this.allEffects && !availableResources) {
      this.allEffects = allEffects;
    }

    return allEffects;
  }

  getLoadedEffects(): EffectSet {
    const resources = this.getLabResources();
    return this.getCompoundByEffects(resources);
  }

  getAvailableEffects(kernel: Kernel, base: Base): EffectSet {
    const availableResources = getStoredResources(base);
    const loadedResource = this.getLabResources();

    // TODO the merge does not sum values
    // @REACTOR double check this
    const combined = new Map(Array.from(availableResources.entries()).concat(Array.from(loadedResource.entries())));
    return this.getCompoundByEffects(combined);
  }

  getDesiredEffects(kernel: Kernel): EffectSet {
    const desiredEffects: EffectSet = new Map();
    const allEffects = this.getCompoundByEffects();

    let request = null;
    // eslint-disable-next-line no-cond-assign
    while (request = kernel.getTopics().getNextRequest(TOPICS.BOOST_PREP)) {
      const requestedEffects = request.details[MEMORY.PREPARE_BOOSTS];
      if (!requestedEffects) {
        continue;
      }

      requestedEffects.forEach((requested) => {
        desiredEffects.set(requested, allEffects.get(requested));
      });
    }

    return desiredEffects;
  }
  getNeeds(loadedEffects: EffectSet, desiredEffects: EffectSet, trace: Tracer): [string[], string[], StructureLab[]] {
    const loadedNames = [...loadedEffects.keys()];
    const desiredNames = [...desiredEffects.keys()];
    let preparedNames = _.intersection(loadedNames, desiredNames);

    preparedNames = preparedNames.filter((effectName) => {
      const effect = loadedEffects.get(effectName);
      const compound = effect.compounds[0].name;
      const lab = this.getLabByResource(compound);
      const currentAmount = lab.store.getUsedCapacity(compound);
      if (currentAmount < MIN_COMPOUND) {
        trace.info('not enough of compound', {compound, effectName, currentAmount});
        return false;
      }

      return true;
    });

    const needToLoad = _.difference(desiredNames, preparedNames);
    const couldUnload = _.difference(loadedNames, preparedNames);
    const emptyLabs = this.getEmptyLabs();

    return [needToLoad, couldUnload, emptyLabs];
  }

  sendHaulRequests(kernel: Kernel, base: Base, loadedEffects: EffectSet, needToLoad: string[],
    emptyLabs: StructureLab[], couldUnload: string[], trace: Tracer) {
    const numToLoad = needToLoad.length;
    const numEmpty = emptyLabs.length;

    if (numEmpty && numToLoad) {
      const numReadyToLoad = _.min([numEmpty, numToLoad]);
      const load = needToLoad.slice(0, numReadyToLoad);
      this.requestMaterialsForLabs(kernel, base, load, trace);
    }

    if (numToLoad > numEmpty) {
      const numToUnload = numToLoad - numEmpty;
      const unload = couldUnload.slice(0, numToUnload);
      this.requestUnloadOfLabs(kernel, base, loadedEffects, unload, trace);
    }
  }

  rebalanceLabs(kernel: Kernel, base: Base, trace: Tracer) {
    const labs = this.getLabs();
    labs.forEach((lab) => {
      if (!lab.mineralType) {
        trace.info('lab has no mineral loaded', {labId: lab.id});
        return;
      }

      const currentAmount = lab.store.getUsedCapacity(lab.mineralType);
      let amount = 0;
      if (currentAmount < MIN_COMPOUND) {
        trace.info('lab is below min: unload it', {labId: lab.id, resource: lab.mineralType});
        amount = currentAmount;
      } else if (currentAmount > MAX_COMPOUND) {
        trace.info('lab is above min: return some', {labId: lab.id, resource: lab.mineralType});
        amount = currentAmount - MAX_COMPOUND;
      }

      if (amount) {
        const dropoff = getStructureForResource(base, lab.mineralType);
        if (!dropoff) {
          trace.info('no dropoff for already loaded compound', {resource: lab.mineralType});
          return;
        }

        const details = {
          [MEMORY.TASK_ID]: `bmc-${this.id}-${Game.time}`,
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
          [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
          [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
        };

        trace.info('boost clear low', {priority: PRIORITIES.HAUL_BOOST, details});

        kernel.getTopics().addRequest(getBaseDistributorTopic(base.id), PRIORITIES.HAUL_BOOST,
          details, REQUEST_REBALANCE_TTL);
      }
    });
  }

  requestUnloadOfLabs(kernel: Kernel, base: Base, loadedEffects: EffectSet, couldUnload: string[],
    trace: Tracer) {
    couldUnload.forEach((toUnload) => {
      const effect = loadedEffects.get(toUnload);
      const compound = effect.compounds[0];

      const pickup = this.getLabByResource(compound.name);
      if (!pickup) {
        trace.info('no pickup for already loaded compound', {resource: compound.name});
        return;
      }

      const baseCreeps = kernel.getCreepsManager().getCreepsByBase(this.baseId);
      const assignedCreeps = baseCreeps.filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskPickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.TASK_HAUL && taskPickup === pickup.id && resource == compound.name;
      });
      if (assignedCreeps.length) {
        trace.info('creep already unloading', {resource: compound.name});
        return;
      }

      const dropoff = getStructureForResource(base, compound.name);
      if (!dropoff) {
        trace.info('no dropoff for already loaded compound', {resource: compound.name});
        return;
      }

      const details = {
        [MEMORY.TASK_ID]: `bmu-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
        [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: pickup.store.getUsedCapacity(compound.name),
      };

      trace.info('boost unload', {priority: PRIORITIES.HAUL_BOOST, details});

      kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.UNLOAD_BOOST,
        details, REQUEST_UNLOAD_TTL);
    });
  }

  requestMaterialsForLabs(kernel: Kernel, base: Base, needToLoad, trace: Tracer) {
    const allEffects = this.getCompoundByEffects();
    const storedResources = getStoredResources(base);

    needToLoad.forEach((toLoad) => {
      trace.info('need to load', {toLoad});
      const effect = allEffects.get(toLoad);
      if (!effect) {
        trace.info('not able to find desired effect', {toLoad});
        return;
      }

      const emptyLabs = this.getEmptyLabs();
      if (emptyLabs.length === 0) {
        trace.info('no destination for available compound', {toLoad});
        return;
      }

      const emptyLab = emptyLabs[0];

      const baseCreeps = kernel.getCreepsManager().getCreepsByBase(this.baseId);
      const assignedCreeps = baseCreeps.filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskDropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.TASK_HAUL && taskDropoff === emptyLab.id && resource !== RESOURCE_ENERGY;
      });
      if (assignedCreeps.length) {
        trace.info('creep already loading', {toLoad});
        return;
      }

      // Refactor this to a a function that further filters a set of effects
      const compound = effect.compounds.reduce((selected, compound) => {
        if (storedResources.get(compound.name) >= MIN_COMPOUND) {
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
        trace.info('no compound available for', {toLoad});
        return;
      }

      this.requestHaulingOfMaterial(kernel, base, compound, emptyLab, trace);
    });
  }

  requestHaulingOfMaterial(kernel: Kernel, base: Base, compound, lab, trace: Tracer) {
    const pickup = getStructureWithResource(base, compound.name);
    if (!pickup) {
      trace.info('no pickup for available compound', {resource: compound.name});
      return;
    }

    const details = {
      [MEMORY.TASK_ID]: `brl-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
      [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
      [MEMORY.MEMORY_HAUL_AMOUNT]: MAX_COMPOUND,
    };

    trace.info('boost load material', {priority: PRIORITIES.HAUL_BOOST, details});

    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_BOOST,
      details, REQUEST_LOAD_TTL);
  }

  requestEnergyForLabs(kernel: Kernel, base: Base, trace: Tracer) {
    const labs = this.getLabs();
    labs.forEach((lab) => {
      // Only fill lab if needed
      if (lab.store.getUsedCapacity(RESOURCE_ENERGY) >= MIN_ENERGY) {
        trace.info('lab has energy', {labId: lab.id});
        return;
      }

      const pickup = getStructureWithResource(base, RESOURCE_ENERGY);
      const currentEnergy = lab.store.getUsedCapacity(RESOURCE_ENERGY);
      const details = {
        [MEMORY.TASK_ID]: `bel-${this.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: MAX_ENERGY - currentEnergy,
      };

      trace.info('boost load energy', {labId: lab.id, priority: PRIORITIES.HAUL_BOOST, details});

      kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_BOOST,
        details, REQUEST_ENERGY_TTL);
    });
  }
}
