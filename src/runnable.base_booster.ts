import {Base} from "./config";
import * as MEMORY from "./constants.memory";
import * as PRIORITIES from "./constants.priorities";
import * as TASKS from "./constants.tasks";
import * as TOPICS from "./constants.topics";
import {Tracer} from './lib.tracing';
import OrgRoom, {ResourceCounts} from "./org.room";
import {sleeping, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getBaseDistributorTopic} from "./topics";

const MIN_COMPOUND = 500;
const MAX_COMPOUND = 2000;
const MIN_ENERGY = 1000;
const MAX_ENERGY = 2000;

const REQUEST_UNLOAD_TTL = 5;
const REQUEST_LOAD_TTL = 5;
const REQUEST_ENERGY_TTL = 5;
const REQUEST_REBALANCE_TTL = 10;
const UPDATE_ROOM_BOOSTER_INTERVAL = 5;

export const TOPIC_ROOM_BOOSTS = "room_boosts";
export type BoosterDetails = {
  roomId: string;
  position: RoomPosition;
  allEffects: EffectSet;
  availableEffects: EffectSet;
  labsByResource: LabsByResource;
}

class Compound {
  name: ResourceConstant;
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

export type EffectSet = Record<string, Effect>;
export type LabsByResource = Record<Partial<MineralConstant | MineralCompoundConstant>, StructureLab>;

export default class BoosterRunnable {
  id: string;
  baseId: string;
  orgRoom: OrgRoom;
  labIds: Id<StructureLab>[];
  boostPosition: RoomPosition;
  allEffects: EffectSet;

  threadUpdateRoomBooster: ThreadFunc;

  constructor(id: string, baseId: string, orgRoom: OrgRoom, labIds: Id<StructureLab>[]) {
    this.id = id;
    this.baseId = baseId;
    this.orgRoom = orgRoom;
    this.labIds = labIds;
    this.allEffects = null;

    this.boostPosition = this.getCreepBoostPosition();
    this.threadUpdateRoomBooster = thread('update_room_booster', UPDATE_ROOM_BOOSTER_INTERVAL)(this.updateRoomBooster.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('booster_run');

    const base = kingdom.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('Base not found', {baseId: this.baseId});
      trace.end();
      return terminate();
    }

    let labs = this.getLabs();
    if (labs.length !== 3) {
      trace.info('not right number of labs - terminating', {num: labs.length})
      trace.end();
      return terminate();
    }

    trace.info('booster run', {labId: labs.map(lab => lab.id)});

    const resourceEnd = trace.startTimer("resource");
    const loadedEffects = this.getLoadedEffects();
    const desiredEffects = this.getDesiredEffects();
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
      emptyLabIds: emptyLabs.map(lab => lab.id),
    });

    let sleepFor = REQUEST_ENERGY_TTL;
    this.requestEnergyForLabs(kingdom, trace);
    this.threadUpdateRoomBooster(trace);

    if (Object.keys(desiredEffects).length) {
      sleepFor = REQUEST_LOAD_TTL;
      this.sendHaulRequests(kingdom, loadedEffects, needToLoad, emptyLabs, couldUnload, trace);
    } else {
      sleepFor = REQUEST_UNLOAD_TTL;
      this.rebalanceLabs(kingdom, base, trace);
    }

    trace.end();

    return sleeping(sleepFor);
  }

  getLabs() {
    return this.labIds.map(labId => Game.getObjectById(labId)).filter((lab => lab));
  }

  updateRoomBooster(trace: Tracer) {
    const resourceEnd = trace.startTimer("resources");
    const allEffects = this.getEffects();
    const availableEffects = this.getAvailableEffects();
    const labsByResource = this.getLabsByResource();
    resourceEnd();

    const details: BoosterDetails = {
      roomId: this.orgRoom.id,
      position: this.boostPosition,
      allEffects,
      availableEffects,
      labsByResource,
    };

    trace.log('publishing room boosts', {
      room: this.orgRoom.id,
      position: this.boostPosition,
      labsByResource: _.reduce(labsByResource, (labs, lab) => {
        labs[lab.id] = lab.mineralType;
        return labs;
      }, {}),
      availableEffects
    });

    this.orgRoom.sendRequest(TOPIC_ROOM_BOOSTS, 1, details, UPDATE_ROOM_BOOSTER_INTERVAL);
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

  getLabsByResource(): Record<Partial<(MineralConstant | MineralCompoundConstant)>, StructureLab> {
    const labs = this.getLabs();
    return labs.reduce((acc, lab) => {
      if (lab.mineralType) {
        acc[lab.mineralType] = lab;
      }

      return acc;
    }, {} as LabsByResource);
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
  getLabResources(): ResourceCounts {
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

  getEffects(availableResources = null): EffectSet {
    // If we are after all events and they are already cached, then return the cache
    if (!availableResources && this.allEffects) {
      return this.allEffects;
    }

    const allEffects: EffectSet = {};

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

    // If all effects are not already cached, cache them.
    // Do not cache if we are checking against available resources.
    if (!this.allEffects && !availableResources) {
      this.allEffects = allEffects;
    }

    return allEffects;
  }

  getLoadedEffects(): EffectSet {
    const resources = this.getLabResources();
    return this.getEffects(resources);
  }

  getAvailableEffects(): EffectSet {
    const availableResources = this.orgRoom.getReserveResources();
    const loadedResource = this.getLabResources();

    // TODO the merge does not sum values
    return this.getEffects(_.assign(availableResources, loadedResource));
  }

  getDesiredEffects(): EffectSet {
    const desiredEffects: EffectSet = {};
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

  sendHaulRequests(kernel: Kernel, loadedEffects, needToLoad, emptyLabs, couldUnload, trace: Tracer) {
    const numToLoad = needToLoad.length;
    const numEmpty = emptyLabs.length;

    if (numEmpty && numToLoad) {
      const numReadyToLoad = _.min([numEmpty, numToLoad]);
      const load = needToLoad.slice(0, numReadyToLoad);
      this.requestMaterialsForLabs(kingdom, load, trace);
    }

    if (numToLoad > numEmpty) {
      const numToUnload = numToLoad - numEmpty;
      const unload = couldUnload.slice(0, numToUnload);
      this.requestUnloadOfLabs(kingdom, loadedEffects, unload, trace);
    }
  }
  rebalanceLabs(kernel: Kernel, base: Base, trace: Tracer) {
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
          [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
          [MEMORY.MEMORY_HAUL_PICKUP]: lab.id,
          [MEMORY.MEMORY_HAUL_RESOURCE]: lab.mineralType,
          [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
          [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
        };

        trace.log('boost clear low', {priority: PRIORITIES.HAUL_BOOST, details});

        kingdom.sendRequest(getBaseDistributorTopic(base.id), PRIORITIES.HAUL_BOOST,
          details, REQUEST_REBALANCE_TTL);
      }
    });
  }
  requestUnloadOfLabs(kernel: Kernel, loadedEffects, couldUnload, trace: Tracer) {
    couldUnload.forEach((toUnload) => {
      const effect = loadedEffects[toUnload];
      const compound = effect.compounds[0];

      const pickup = this.getLabByResource(compound.name);
      if (!pickup) {
        trace.log('no pickup for already loaded compound', {resource: compound.name});
        return;
      }

      const baseCreeps = kingdom.creepManager.getCreepsByBase(this.baseId);
      const assignedCreeps = baseCreeps.filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskPickup = creep.memory[MEMORY.MEMORY_HAUL_PICKUP];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.TASK_HAUL && taskPickup === pickup.id && resource == compound.name;
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
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: compound.name,
        [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: pickup.store.getUsedCapacity(compound.name),
      };

      trace.log('boost unload', {priority: PRIORITIES.HAUL_BOOST, details});

      kingdom.sendRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.UNLOAD_BOOST,
        details, REQUEST_UNLOAD_TTL);
    });
  }
  requestMaterialsForLabs(kernel: Kernel, needToLoad, trace: Tracer) {
    const reserveResources = this.orgRoom.getReserveResources();

    needToLoad.forEach((toLoad) => {
      trace.log('need to load', {toLoad})
      const effect = this.allEffects[toLoad];
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

      const baseCreeps = kingdom.creepManager.getCreepsByBase(this.baseId);
      const assignedCreeps = baseCreeps.filter((creep) => {
        const task = creep.memory[MEMORY.MEMORY_TASK_TYPE];
        const taskDropoff = creep.memory[MEMORY.MEMORY_HAUL_DROPOFF];
        const resource = creep.memory[MEMORY.MEMORY_HAUL_RESOURCE];
        return task === TASKS.TASK_HAUL && taskDropoff === emptyLab.id && resource !== RESOURCE_ENERGY;
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

      this.requestHaulingOfMaterial(kingdom, compound, emptyLab, trace);
    });
  }

  requestHaulingOfMaterial(kernel: Kernel, compound, lab, trace: Tracer) {
    const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(compound.name, true);
    if (!pickup) {
      trace.log('no pickup for available compound', {resource: compound.name});
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

    trace.log('boost load material', {priority: PRIORITIES.HAUL_BOOST, details});

    kingdom.sendRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_BOOST, details, REQUEST_LOAD_TTL);
  }

  requestEnergyForLabs(kernel: Kernel, trace: Tracer) {
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
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
        [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: lab.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: MAX_ENERGY - currentEnergy,
      };

      trace.log('boost load energy', {labId: lab.id, priority: PRIORITIES.HAUL_BOOST, details});

      kingdom.sendRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_BOOST, details, REQUEST_ENERGY_TTL);
    });
  }
}




this.boosterPosition = null;
this.boosterEffects = null;
this.boosterAllEffects = null;
this.boosterLabs = null;
this.threadUpdateBoosters = thread('update_booster_thread', UPDATE_BOOSTER_TTL)((trace, room, kingdom) => {
  const topic = this.getTopics().getTopic(TOPIC_ROOM_BOOSTS);
  if (!topic) {
    trace.log('no topic', {room: this.id});
    return;
  }

  topic.forEach((event) => {
    const details: BoosterDetails = event.details;
    trace.log('booster position', {room: this.id, details});

    this.boosterPosition = details.position;
    this.boosterEffects = details.availableEffects;
    this.boosterAllEffects = details.allEffects;
    this.boosterLabs = details.labsByResource;
  })
});
