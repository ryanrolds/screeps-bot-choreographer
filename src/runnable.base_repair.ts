import {Base, getBasePrimaryRoom, getEnergyFullness, getReserveBuffer, getStoredResourceAmount} from './base';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {running, sleeping, terminate} from './os.process';
import {Runnable, RunnableResult} from './os.runnable';
import {thread, ThreadFunc} from './os.thread';

const UPDATE_DAMAGED_STRUCTURES_TTL = 40;
const UPDATE_DAMAGED_SECONDARY_TTL = 15;

const WALL_LEVEL = 1000;
const RAMPART_LEVEL = 1000;
const UPGRADER_BUFFER = 25000;
// TODO increase this later, we should be able to sustain at least one nuke
// before the walls break
const MAX_WALL_HITS = 11000000;

export default class RepairRunnable implements Runnable {
  baseId: string;
  defenseHitsLimit: number;
  damagedStructures: Structure[];
  damagedSecondaryStructures: Structure[];

  threadUpdateDamagedStructure: ThreadFunc;
  threadUpdateDamagedSecondaryStructures: ThreadFunc;

  constructor(baseId: string) {
    this.baseId = baseId;
    this.damagedStructures = [];
    this.damagedSecondaryStructures = [];

    this.threadUpdateDamagedStructure = thread('damaged_structures_thread',
      UPDATE_DAMAGED_STRUCTURES_TTL)(this.updateDamagedStructures.bind(this));

    this.threadUpdateDamagedSecondaryStructures = thread('secondary_structures_thread',
      UPDATE_DAMAGED_SECONDARY_TTL)(this.updateDamagedSecondaryStructures.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.as('repair_run');

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('no base config for room', {baseId: this.baseId});
      return terminate();
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error('base primary room not visible', {baseId: this.baseId});
      trace.end();
      return sleeping(10);
    }

    this.threadUpdateDamagedStructure(trace, kernel, room);
    this.threadUpdateDamagedSecondaryStructures(trace, kernel, base, room);

    trace.end();

    return running();
  }

  updateDamagedStructures(trace: Tracer, kernel: Kernel, room: Room) {
    const damagedStructures = room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return s.hits < s.hitsMax && (
          s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART &&
          s.structureType != STRUCTURE_ROAD);
      },
    });

    this.damagedStructures = _.map(damagedStructures, 'id');
  }

  updateDamagedSecondaryStructures(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    const rcLevel = room.controller.level.toString();
    const rcLevelHitsMax = RAMPART_HITS_MAX[rcLevel] || 10000;

    const energyFullness = getEnergyFullness(base) * 10;
    this.defenseHitsLimit = rcLevelHitsMax * Math.pow(0.45, (10 - energyFullness));

    if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
      this.defenseHitsLimit = 10000;
    }

    // If energy in reserve is less then we need to sustain a max ugprader,
    // then limit the amount our defense hits
    const reserveEnergy = getStoredResourceAmount(base, RESOURCE_ENERGY);
    const reserveBuffer = getReserveBuffer(base);
    if (reserveEnergy < reserveBuffer + UPGRADER_BUFFER) {
      this.defenseHitsLimit = _.min([this.defenseHitsLimit, MAX_WALL_HITS]);
    }

    let damagedSecondaryStructures = room.find(FIND_STRUCTURES, {
      filter: (s) => {
        return s.hits < s.hitsMax && (
          s.structureType == STRUCTURE_RAMPART ||
          s.structureType == STRUCTURE_WALL) &&
          s.hits < this.defenseHitsLimit;
      },
    });
    damagedSecondaryStructures = _.sortBy(damagedSecondaryStructures, (structure) => {
      return structure.hits;
    });

    this.damagedSecondaryStructures = _.map(damagedSecondaryStructures, 'id');

    trace.info('damaged secondary structures', {
      room: this.baseId,
      defenseHitsLimit: this.defenseHitsLimit,
      damagedSecondaryStructures: this.damagedSecondaryStructures,
    });
  }
}

