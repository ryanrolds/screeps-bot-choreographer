import * as MEMORY from '../constants/memory';
import * as PRIORITIES from '../constants/priorities';
import * as TASKS from '../constants/tasks';
import {getBaseDistributorTopic} from '../creeps/roles/distributor';
import {Tracer} from '../lib/tracing';
import {Base, getBasePrimaryRoom, getStructureForResource, getStructureWithResource} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {RunnableResult, sleeping, terminate} from '../os/process';
import {BaseRoomThreadFunc, threadBaseRoom} from '../os/threads/base_room';

const TICK_STEP = 2;
const PROCESS_TTL = 250;
const HAUL_TTL = 10;
const ENERGY_READY_AMOUNT = 600;
const UPDATE_STRUCTURES_TTL = 100;

export default class LinkManager {
  id: string;
  baseId: string;
  storageId: Id<StructureStorage>;
  storageLink: Id<StructureLink>;
  sourceLinks: Id<StructureLink>[];
  sinkLinks: Id<StructureLink>[];
  ttl: number;
  haulTTL: number;
  prevTime: number;

  threadUpdateStructures: BaseRoomThreadFunc;

  constructor(id: string, baseId: string) {
    this.id = id;
    this.baseId = baseId;

    this.storageLink = null;
    this.sourceLinks = [];
    this.sinkLinks = null;
    this.ttl = PROCESS_TTL;
    this.haulTTL = 0;
    this.prevTime = Game.time;

    this.threadUpdateStructures = threadBaseRoom('update_structures', UPDATE_STRUCTURES_TTL)(this.updateStructures.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('link_manager_run');

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.haulTTL -= ticks;

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.info('no base config for room', {baseId: this.baseId});
      return terminate();
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error('base primary room not visible', {baseId: this.baseId});
      trace.end();
      return;
    }

    this.threadUpdateStructures(trace, kernel, base, room);

    trace.info('running', {
      storageId: this.storageId,
      storageLink: this.storageLink,
      sourceLinks: this.sourceLinks,
      sinkLinks: this.sinkLinks,
      haulTTL: this.haulTTL,
      ttl: this.ttl,
    });

    if (!this.storageLink) {
      trace.info('sleeping due to not having a storage link', {});
      trace.end();
      return sleeping(PROCESS_TTL);
    }

    const storageLink = Game.getObjectById<Id<StructureLink>>(this.storageLink);
    if (!this.storageId || !storageLink) {
      trace.info('sleeping due to missing storage or storage link', {});
      trace.end();

      return sleeping(PROCESS_TTL); // Removed +1 from this 4/25/22
    }

    let performedTransfer = false;

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
        trace.info('should terminate due to missing source link', {linkId});
        shouldTerminate = true;
        trace.end();
        return null;
      }

      return link;
    }).filter((link) => canTransfer(link));

    // Include storage link if it has energy and it isn't being hauled
    if (notEmpty(storageLink) && this.haulTTL <= 0) {
      hasEnergy.push(storageLink);
    }

    // Get links that need energy and transfer if we have source links with energy
    this.sinkLinks.map((linkId) => {
      const link = Game.getObjectById<Id<StructureLink>>(linkId);
      if (!link) {
        trace.info('should terminate due to missing sink link', {linkId});
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

    trace.info('has energy', {hasEnergy, haulTTL: this.haulTTL, performedTransfer});

    if (!performedTransfer && this.haulTTL < 0) {
      // If we have no source ready with energy for sinks, then load energey into storage
      if (!hasEnergy.length) {
        const amount = storageLink.store.getFreeCapacity(RESOURCE_ENERGY);
        if (amount) {
          const pickup = getStructureWithResource(base, RESOURCE_ENERGY);
          if (pickup) {
            this.fillLink(kernel, storageLink, pickup, _.min([amount, ENERGY_READY_AMOUNT]), trace);
          }
        }
      } else if (hasEnergy.length > 1) { // If we have more than one source link ready, unload storage link
        const amount = storageLink.store.getUsedCapacity(RESOURCE_ENERGY);
        if (amount) {
          const dropoff = getStructureForResource(base, RESOURCE_ENERGY);
          if (dropoff) {
            this.emptyLink(kernel, storageLink, dropoff, amount, trace);
          }
        }
      }
    }

    // Check if we need to terminate due to being stale
    // TODO change in links or storage should cause termination; then remove ttl
    if (shouldTerminate) {
      trace.info('terminating link process', {});
      trace.end();
      return terminate();
    }

    trace.end();

    return sleeping(TICK_STEP);
  }

  updateStructures(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    this.storageId = room.storage?.id;
    if (!this.storageId) {
      throw new Error('cannot create a link manager when room does not have storage');
    }

    // TODO move these to a thread
    if (room.storage) {
      this.storageLink = room.storage.pos.findInRange<StructureLink>(FIND_STRUCTURES, 3, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK && structure.isActive();
        },
      })[0]?.id;
    }

    const sources = room.find(FIND_SOURCES);
    this.sourceLinks = sources.map((source) => {
      return source.pos.findInRange<StructureLink>(FIND_STRUCTURES, 2, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK && structure.isActive();
        },
      })[0]?.id;
    }).filter((value) => value);

    const controller = room.controller;
    if (controller) {
      this.sinkLinks = controller.pos.findInRange<StructureLink>(FIND_STRUCTURES, 4, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_LINK && structure.isActive();
        },
      }).map((link) => {
        return link.id;
      });
    }
  }

  emptyLink(kernel: Kernel, link: StructureLink, dropoff: AnyStoreStructure, amount: number, trace: Tracer) {
    this.haulTTL = HAUL_TTL;

    const details = {
      [MEMORY.TASK_ID]: `lu-${link.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: link.id,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_DROPOFF]: dropoff.id,
    };

    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.UNLOAD_LINK, details, HAUL_TTL);
    trace.info('haul energy from storage link', {request: details});
  }

  fillLink(kernel: Kernel, link: StructureLink, pickup: AnyStoreStructure, amount: number, trace: Tracer) {
    this.haulTTL = HAUL_TTL;

    const details = {
      [MEMORY.TASK_ID]: `ll-${link.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickup.id,
      [MEMORY.MEMORY_HAUL_AMOUNT]: amount,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_DROPOFF]: link.id,
    };

    trace.info('haul energy to storage link', {request: details});
    kernel.getTopics().addRequest(getBaseDistributorTopic(this.baseId), PRIORITIES.LOAD_LINK, details, HAUL_TTL);
  }
}

const transferEnergy = (source: StructureLink, sink: StructureLink, trace: Tracer) => {
  const amount = _.min([
    source.store.getUsedCapacity(RESOURCE_ENERGY),
    sink.store.getFreeCapacity(RESOURCE_ENERGY),
  ]);

  const result = source.transferEnergy(sink, amount);
  trace.info('transfer energy', {
    source: source.id,
    sink: sink.id,
    result,
  });
};

const canTransfer = (link: StructureLink): boolean => {
  return link?.store.getUsedCapacity(RESOURCE_ENERGY) >= ENERGY_READY_AMOUNT && link.cooldown < 1;
};

const canReceive = (link: StructureLink): boolean => {
  return link?.store.getFreeCapacity(RESOURCE_ENERGY) >= ENERGY_READY_AMOUNT;
};

const notEmpty = (link: StructureLink): boolean => {
  return link?.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
};
