import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import {exception} from "node:console";

const TICK_STEP = 2;
const PROCESS_TTL = 250;
const HAUL_TTL = 15;

export default class LinkManager {
  id: string;
  orgRoom: OrgRoom;
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
      })[0]?.id;
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
    trace = trace.asId(this.id);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.haulTTL -= ticks;

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      return terminate();
    }

    trace.log('running', {
      storage: this.storage,
      storageLink: this.storageLink,
      sourceLinks: this.sourceLinks,
      sinkLinks: this.sinkLinks,
      haulTTL: this.haulTTL,
      ttl: this.ttl,
    })

    let performedTransfer = false;

    const storageLink = Game.getObjectById<StructureLink>(this.storageLink);
    if (!this.storage || !storageLink) {
      trace.log("exiting due to missing storage or storage link", {});
      return terminate();
    }

    // If our link Ids are old we should terminate
    let shouldTerminate = false;
    this.ttl -= ticks;
    if (this.ttl < 0) {
      shouldTerminate = true;
    }

    // Create list of links with energy
    const hasEnergy = this.sourceLinks.map((linkId) => {
      const link = Game.getObjectById<StructureLink>(linkId);
      if (!link) {
        shouldTerminate = true;
        return null;
      }

      return link;
    }).filter(link => canTransfer(link));

    // Include storage link if it has energy and it isn't being hauled
    if (notEmpty(storageLink) && this.haulTTL <= 0) {
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
    }).forEach((sink) => {
      if (!canReceive(sink)) {
        return;
      }

      const source = hasEnergy.pop();
      if (!source) {
        return;
      }

      performedTransfer = true;

      transferEnergy(source, sink, trace);
    });

    // If storage link needs energy try to get some from a source
    if (canReceive(storageLink)) {
      let source = hasEnergy.pop();
      // Don't transfer to itself
      if (source && source.id === storageLink.id) {
        source = hasEnergy.pop();
      }

      if (source) {
        performedTransfer = true;
        transferEnergy(source, storageLink, trace);
      }
    }

    trace.log('has energy', {hasEnergy, haulTTL: this.haulTTL, performedTransfer})

    if (!performedTransfer && this.haulTTL < 0) {
      // If source links out number sinks, keep the hub empty

      if (this.sourceLinks.length >= this.sinkLinks.length) {
        const amount = storageLink.store.getUsedCapacity(RESOURCE_ENERGY);
        if (amount) {
          const dropoff = this.orgRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY);
          if (dropoff) {
            this.emptyLink(storageLink, dropoff, amount, trace);
          }
        }
        // If as many or more sink links, keep the hub full of energy
      } else if (this.sourceLinks.length < this.sinkLinks.length && !hasEnergy.length) {
        const amount = storageLink.store.getFreeCapacity(RESOURCE_ENERGY);
        if (!amount) {
          const pickup = this.orgRoom.getReserveStructureWithMostOfAResource(RESOURCE_ENERGY, true);
          if (pickup) {
            this.fillLink(storageLink, pickup, amount, trace);
          }
        }
      }
    }

    // Check if we need to terminate due to being stale
    // TODO change in links or storage should cause termination; then remove ttl
    if (shouldTerminate) {
      trace.log('terminating link process', {});
      return terminate();
    }

    return sleeping(TICK_STEP);
  }

  emptyLink(link: StructureLink, dropoff: AnyStoreStructure, amount: number, trace: Tracer) {
    this.haulTTL = HAUL_TTL;

    const details = {
      [MEMORY.TASK_ID]: `lu-${link.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: link.id,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
    };

    (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, 2, details, HAUL_TTL);
    trace.log('haul energy from storage link', {
      request: details,
    });
  }

  fillLink(link: StructureLink, pickup: AnyStoreStructure, amount: number, trace: Tracer) {

    this.haulTTL = HAUL_TTL;

    const details = {
      [MEMORY.TASK_ID]: `ll-${link.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.HAUL_TASK,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_DROPOFF]: link.id,
    };

    (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, 0.9, details, HAUL_TTL);
    trace.log('haul energy to storage link', {
      request: details,
    });
  }
}

const transferEnergy = (source: StructureLink, sink: StructureLink, trace: Tracer) => {
  const amount = _.min([
    source.store.getUsedCapacity(RESOURCE_ENERGY),
    sink.store.getFreeCapacity(RESOURCE_ENERGY)
  ]);

  const result = source.transferEnergy(sink, amount);
  trace.log('transfer energy', {
    source: source.id,
    sink: sink.id,
    result,
  });
}

const canTransfer = (link: StructureLink): boolean => {
  return link?.store.getUsedCapacity(RESOURCE_ENERGY) >= 300 && link.cooldown < 1
};

const canReceive = (link: StructureLink): boolean => {
  return link?.store.getFreeCapacity(RESOURCE_ENERGY) > 300;
};

const notEmpty = (link: StructureLink): boolean => {
  return link?.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
}
