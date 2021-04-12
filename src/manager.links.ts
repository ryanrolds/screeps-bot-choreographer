import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import {exception} from "node:console";

const TICK_STEP = 5;
const PROCESS_TTL = 250;
const HAUL_TTL = 10;

export default class LinkManager {
  orgRoom: OrgRoom;
  id: string;
  storage: Id<StructureStorage>;
  storageLink: Id<StructureLink>;
  sourceLinks: Id<StructureLink>[];
  sinkLinks: Id<StructureLink>[];
  ttl: number;
  haulTTL: number;
  prevTime: number;

  constructor(id: string, orgRoom: OrgRoom) {
    this.id = id;
    this.orgRoom = orgRoom;

    const roomObject = orgRoom.getRoomObject() as Room;
    if (!roomObject) {
      throw new Error('cannot create a link manager when room does not exist');
    }

    this.storage = roomObject.storage?.id;
    this.storageLink = null;
    this.sourceLinks = [];
    this.sinkLinks = null;
    this.ttl = PROCESS_TTL;
    this.haulTTL = 0;
    this.prevTime = Game.time;

    if (roomObject.storage) {
      this.storageLink = roomObject.storage.pos.findInRange<StructureLink>(FIND_STRUCTURES, 3, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK;
        }
      })[0].id;
    }

    const sources = roomObject.find(FIND_SOURCES);
    this.sourceLinks = sources.map((source) => {
      return source.pos.findInRange<StructureLink>(FIND_STRUCTURES, 2, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK;
        }
      })[0]?.id;
    }).filter(value => value);

    const controller = roomObject.controller
    if (controller) {
      this.sinkLinks = controller.pos.findInRange<StructureLink>(FIND_STRUCTURES, 4, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK;
        }
      }).map((link) => {
        return link.id;
      });
    }
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.haulTTL -= ticks;

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      return terminate();
    }

    trace.log(this.id, 'running', {
      storage: this.storage,
      storageLink: this.storageLink,
      sourceLinks: this.sourceLinks,
      sinkLinks: this.sinkLinks,
      haulTTL: this.haulTTL,
      ttl: this.ttl,
    })

    const storageLink = Game.getObjectById<StructureLink>(this.storageLink);
    if (!this.storage || !storageLink) {
      trace.log(room.name, "exiting due to missing storage or storage link", {});
      return terminate();
    }

    // If our link Ids are old we should terminate
    let shouldTerminate = false;
    this.ttl -= ticks;
    if (this.ttl < 0) {
      shouldTerminate = true;
    }

    // Create list of links with energyu
    const hasEnergy = this.sourceLinks.map((linkId) => {
      const link = Game.getObjectById<StructureLink>(linkId);
      if (!link) {
        shouldTerminate = true;
        return null;
      }

      return link;
    }).filter(link => canTransfer(link));

    // Include storage link if it has energy and it isn't being hauled
    if (canTransfer(storageLink) && this.haulTTL <= 0) {
      hasEnergy.push(storageLink);
    }

    // Get links that need energy and transfer if we have source links with energy
    this.sinkLinks.map((linkId) => {
      const link = Game.getObjectById<StructureLink>(linkId);
      if (!link) {
        shouldTerminate = true;
        return null;
      }

      return link;
    }).forEach((link) => {
      if (!canReceive(link)) {
        return;
      }

      const source = hasEnergy.pop();
      if (!source) {
        return;
      }

      const result = source.transferEnergy(link);
      trace.log(this.id, 'transfer energy', {
        source: source.id,
        sink: link.id,
        result,
      });
    });

    // If storage link needs energy try to get some from a source
    if (canReceive(storageLink)) {
      const source = hasEnergy.pop();
      if (source) {
        const result = source.transferEnergy(storageLink);
        trace.log(this.id, 'transfer energy', {
          source: source.id,
          sink: storageLink.id,
          result,
        });
      }
    }

    trace.log(this.id, 'has energy', {hasEnergy, haulTTL: this.haulTTL})

    // If we have 2 links of energy ready, empty storage link to make room
    if (hasEnergy.length >= 2 && hasEnergy.indexOf(storageLink) != -1 && this.haulTTL < 0) {
      const reserve = this.orgRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
      if (!reserve) {
        return running();
      }

      const amount = storageLink.store.getUsedCapacity(RESOURCE_ENERGY);
      if (!amount) {
        return running();
      }

      this.haulTTL = HAUL_TTL;

      const details = {
        [MEMORY.TASK_ID]: `lu-${storageLink.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: storageLink.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: reserve.id,
      };

      (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, 2, details, HAUL_TTL);
      trace.log(this.id, 'haul energy from storage link', {
        request: details,
      });

      // If we have no links of energy ready, get energy from reserve
    } else if (!hasEnergy.length && this.haulTTL < 0) {
      const reserve = this.orgRoom.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, true);
      if (!reserve) {
        return running();;
      }

      const amount = storageLink.store.getFreeCapacity(RESOURCE_ENERGY);
      if (!amount) {
        return running();;
      }

      this.haulTTL = HAUL_TTL;

      const details = {
        [MEMORY.TASK_ID]: `ll-${storageLink.id}-${Game.time}`,
        [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
        [MEMORY.MEMORY_HAUL_PICKUP]: reserve.id,
        [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
        [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
        [MEMORY.MEMORY_HAUL_DROPOFF]: storageLink.id,
      };

      (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, 1, details, HAUL_TTL);
      trace.log(this.id, 'haul energy to storage link', {
        request: details,
      });
    }

    // Check if we need to terminate due to being stale
    // TODO change in links or storage should cause termination; then remove ttl
    if (shouldTerminate) {
      trace.log(this.id, 'terminating link process', {});
      return terminate();
    }

    return sleeping(TICK_STEP);
  }
}

const canTransfer = (link: StructureLink): boolean => {
  return link?.store.getUsedCapacity(RESOURCE_ENERGY) >= 400 && link.cooldown < 1
}

const canReceive = (link: StructureLink): boolean => {
  return link?.store.getFreeCapacity(RESOURCE_ENERGY) > 400
}
