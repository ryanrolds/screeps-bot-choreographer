import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as PRIORITIES from "./constants.priorities"

const REQUEST_RESOURCES_TTL = 25;

export default class NuckerRunnable {
  orgRoom: OrgRoom;
  id: Id<StructureNuker>;

  damagedCreep: Id<Creep>;
  repairTarget: Id<AnyStructure>;

  haulTTL: number;
  repairTTL: number;
  prevTime: number;

  constructor(room: OrgRoom, tower: StructureNuker) {
    this.orgRoom = room;

    this.id = tower.id;
    this.haulTTL = 0;
    this.repairTTL = 0;
    this.prevTime = Game.time;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.haulTTL -= ticks;
    this.repairTTL -= ticks;

    const room = this.orgRoom.getRoomObject()
    if (!room) {
      return terminate();
    }

    const nuker = Game.getObjectById(this.id);
    if (!nuker) {
      return terminate();
    }

    let readyToFire = !nuker.cooldown;

    const neededEnergy = nuker.store.getFreeCapacity(RESOURCE_ENERGY);
    if (neededEnergy > 0) {
      trace.log('need energy', {neededEnergy});
      this.requestResource(RESOURCE_ENERGY, neededEnergy, trace);
      readyToFire = false;
    }

    const neededGhodium = nuker.store.getFreeCapacity(RESOURCE_GHODIUM);
    if (neededGhodium > 0) {
      trace.log('need ghodium', {neededGhodium});
      this.requestResource(RESOURCE_GHODIUM, neededGhodium, trace);
      readyToFire = false;
    }

    if (readyToFire) {
      trace.log('lets play global thermonuclear war');

      const request = (kingdom as any).getNextRequest(TOPICS.NUKER_TARGETS);
      if (request) {
        const positionStr = request.details.position;
        const posArray = positionStr.split(',');

        let position: RoomPosition = null;
        if (posArray && posArray.length === 3) {
          position = new RoomPosition(posArray[0], posArray[1], posArray[2]);
        } else {
          trace.log('problem with position string', {positionStr});
        }

        if (position !== null) {
          trace.log('would nuke', {position});
          const result = nuker.launchNuke(position);
          trace.log('nuker launch result', {result, position});
        }
      }
    }

    return sleeping(REQUEST_RESOURCES_TTL);
  }

  requestResource(resource: ResourceConstant, amount: number, trace: Tracer) {
    const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(resource, true);
    if (!pickup) {
      trace.log('unable to get resource from reserve', {resource, amount});

      trace.log('requesting resource from governor', {resource, amount});
      (this.orgRoom as any).getKingdom().getResourceGovernor().requestResource(this.orgRoom,
        resource, amount, REQUEST_RESOURCES_TTL, trace);
      return;
    }

    trace.log('requesting load', {
      nuker: this.id,
      resource: resource,
      amount: amount,
      pickup: pickup.id,
      ttl: REQUEST_RESOURCES_TTL,
    });

    (this.orgRoom as any).getColony().sendRequest(TOPICS.HAUL_CORE_TASK, PRIORITIES.HAUL_NUKER, {
      [MEMORY.TASK_ID]: `load-${this.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_RESOURCE]: resource,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_DROPOFF]: this.id,
    }, REQUEST_RESOURCES_TTL);
  }
}
