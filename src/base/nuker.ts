import {Base, getBasePrimaryRoom, getStructureWithResource} from '../os/kernel/base';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TASKS from './constants.tasks';
import * as TOPICS from './constants.topics';
import {Kernel} from './kernel';
import {Tracer} from './lib/tracing';
import {sleeping, terminate} from './os.process';
import {RunnableResult} from './os.runnable';
import {getBaseDistributorTopic} from './role.distributor';

const REQUEST_RESOURCES_TTL = 25;

export default class NukerRunnable {
  id: Id<StructureNuker>;
  baseId: string;

  damagedCreep: Id<Creep>;

  haulTTL: number;
  prevTime: number;

  constructor(baseId: string, nuker: StructureNuker) {
    this.id = nuker.id;
    this.baseId = baseId;

    this.haulTTL = 0;
    this.prevTime = Game.time;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('nuker_run');

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.haulTTL -= ticks;

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('no base config for room', {baseId: this.baseId});
      return terminate();
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.end();
      return terminate();
    }

    const nuker = Game.getObjectById(this.id);
    if (!nuker) {
      trace.end();
      return terminate();
    }

    if (!nuker.isActive()) {
      trace.end();
      return sleeping(100);
    }

    let readyToFire = !nuker.cooldown;

    const neededEnergy = nuker.store.getFreeCapacity(RESOURCE_ENERGY);
    if (neededEnergy > 0) {
      trace.info('need energy', {neededEnergy});
      this.requestResource(kernel, base, RESOURCE_ENERGY, neededEnergy, trace);
      readyToFire = false;
    }

    const neededGhodium = nuker.store.getFreeCapacity(RESOURCE_GHODIUM);
    if (neededGhodium > 0) {
      trace.info('need ghodium', {neededGhodium});
      this.requestResource(kernel, base, RESOURCE_GHODIUM, neededGhodium, trace);
      readyToFire = false;
    }

    if (readyToFire) {
      trace.info('lets play global thermonuclear war');

      const request = kernel.getTopics().getNextRequest(TOPICS.NUKER_TARGETS);
      if (request) {
        const positionStr = request.details.position;
        const posArray = positionStr.split(',');

        let position: RoomPosition = null;
        if (posArray && posArray.length === 3) {
          position = new RoomPosition(posArray[0], posArray[1], posArray[2]);
        } else {
          trace.info('problem with position string', {positionStr});
        }

        if (position !== null) {
          trace.info('would nuke', {position});
          const result = nuker.launchNuke(position);
          trace.notice('nuker launch result', {result, position});
        }
      }
    }

    trace.end();

    return sleeping(REQUEST_RESOURCES_TTL);
  }

  requestResource(kernel: Kernel, base: Base, resource: ResourceConstant, amount: number, trace: Tracer) {
    const pickup = getStructureWithResource(base, resource);
    if (!pickup) {
      trace.info('requesting resource from governor', {resource, amount});
      const resourceGovernor = kernel.getResourceManager();
      const requested = resourceGovernor.requestResource(base, resource, amount, REQUEST_RESOURCES_TTL, trace);
      if (!requested) {
        resourceGovernor.buyResource(base, resource, amount, REQUEST_RESOURCES_TTL, trace);
      }

      return;
    }

    trace.info('requesting load', {
      nuker: this.id,
      resource: resource,
      amount: amount,
      pickup: pickup.id,
      ttl: REQUEST_RESOURCES_TTL,
    });

    const request = {
      [MEMORY.TASK_ID]: `load-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.id,
    }

    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.HAUL_NUKER,
      request, REQUEST_RESOURCES_TTL);
  }
}
