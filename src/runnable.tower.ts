import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as PRIORITIES from "./constants.priorities";
import {trace} from "node:console";

const REQUEST_ENERGY_TTL = 10;
const REQUEST_ENERGY_THRESHOLD = 500;
const EMERGENCY_RESERVE = 250;

interface Point {
  x: number;
  y: number;
}

export default class TowerRunnable {
  orgRoom: OrgRoom;
  towerId: Id<StructureTower>;

  damagedCreep: string; // Creep name FIX
  repairTarget: Id<AnyStructure>;

  haulTTL: number;
  repairTTL: number;
  prevTime: number;

  constructor(room: OrgRoom, tower: StructureTower) {
    this.orgRoom = room;

    this.towerId = tower.id;
    this.haulTTL = 0;
    this.repairTTL = 0;
    this.prevTime = Game.time;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.towerId);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    const room = this.orgRoom.getRoomObject()
    if (!room) {
      return terminate();
    }


    const tower = Game.getObjectById(this.towerId);
    if (!tower) {
      return terminate();
    }

    this.haulTTL -= ticks;
    this.repairTTL -= ticks;

    const towerUsed = tower.store.getUsedCapacity(RESOURCE_ENERGY);

    trace.log("tower runnable", {
      room: room.name,
      id: this.towerId,
      haulTTL: this.haulTTL,
      repairTTL: this.repairTTL,
      repairTarget: this.repairTarget,
      energy: towerUsed,
    });

    // Request energy
    if (towerUsed < REQUEST_ENERGY_THRESHOLD && this.haulTTL < 0) {
      this.haulTTL = REQUEST_ENERGY_TTL;
      trace.log('requesting energy', {});
      this.requestEnergy(this.orgRoom, tower, REQUEST_ENERGY_TTL, trace);
    }

    // Attack hostiles
    const roomId = (this.orgRoom as any).id;
    const targets = (this.orgRoom as any).getColony().getFilteredRequests(TOPICS.PRIORITY_TARGETS,
      (target) => {
        trace.log('finding target', {target, roomId});
        return target.details.roomName === roomId;
      }
    ).reverse();

    if (targets.length) {
      const result = tower.attack(Game.getObjectById(targets[0].details.id));
      trace.log('attacking', {target: targets[0].id, result})
      return running();
    }

    // Heal damaged creeps
    if (!this.damagedCreep && this.orgRoom.damagedCreeps.length) {
      this.damagedCreep = this.orgRoom.damagedCreeps.shift();
    }

    if (this.damagedCreep) {
      const creep = Game.creeps[this.damagedCreep];
      if (!creep || creep.hits >= creep.hitsMax) {
        this.damagedCreep = null;
      } else {
        const result = tower.heal(creep);
        trace.log('healing', {target: creep.id, result})
        return running();
      }
    }

    // Not above attack/heal reserve, skip repair logic
    if (towerUsed < EMERGENCY_RESERVE) {
      trace.log('skipping repairs low energy', {towerUsed});
      return running();
    }

    // Repair focus TTL that spreads repairs out
    if (this.repairTarget && this.repairTTL < 0) {
      trace.log('repair target ttl hit', {});
      this.repairTarget = null;
      this.repairTTL = 0;
    }

    // If target is repaired, picking another target
    if (this.repairTarget) {
      const target = Game.getObjectById(this.repairTarget);
      if (!target || target.hits >= target.hitsMax) {
        trace.log('repair target done/missing', {target});
        this.repairTarget = null;
        this.repairTTL = 0;
      }
    }

    // Repair damaged structure
    if (!this.repairTarget && this.orgRoom.damagedStructures.length) {
      this.repairTarget = this.orgRoom.damagedStructures.shift();
      this.repairTTL = 10;
    }

    // Do not repair secondary structures or roads if room is low on energy
    const minRepairEnergy = room.storage ? 10000 : 2000;
    if (this.orgRoom.resources[RESOURCE_ENERGY] < minRepairEnergy) {
      this.repairTarget = null;
      this.repairTTL = 0;
      return running();
    }

    // Repair damaged secondary structures
    if (!this.repairTarget && this.orgRoom.damagedSecondaryStructures.length) {
      this.repairTarget = this.orgRoom.damagedSecondaryStructures.shift();
      this.repairTTL = 10;
    }

    // Repair damaged roads
    if (!this.repairTarget && this.orgRoom.damagedRoads.length) {
      this.repairTarget = this.orgRoom.damagedRoads.shift();
      this.repairTTL = 0;
    }

    // If no repair target sleep for a bit
    if (!this.repairTarget) {
      trace.log('no repair repair', {});
      return sleeping(5);
    }

    const target = Game.getObjectById(this.repairTarget);
    if (!target) {
      trace.log('repair target missing', {target});
      this.repairTarget = null;
      this.repairTTL = 0;
      return running();
    }

    const result = tower.repair(target);
    trace.log('repair', {target, result, ttl: this.repairTTL});

    return running();
  }

  private requestEnergy(room: OrgRoom, tower: StructureTower, ttl: number, trace: Tracer) {
    const towerUsed = tower.store.getUsedCapacity(RESOURCE_ENERGY);
    const towerFree = tower.store.getFreeCapacity(RESOURCE_ENERGY);
    const towerTotal = tower.store.getCapacity(RESOURCE_ENERGY);

    const pickupId = this.orgRoom.getClosestStoreWithEnergy(tower);
    const priority = ((room.numHostiles) ?
      PRIORITIES.HAUL_TOWER_HOSTILES : PRIORITIES.HAUL_TOWER) - (towerUsed / towerTotal);

    const details = {
      [MEMORY.TASK_ID]: `tel-${tower.id}-${Game.time}`,
      [MEMORY.MEMORY_TASK_TYPE]: TASKS.TASK_HAUL,
      [MEMORY.MEMORY_HAUL_PICKUP]: pickupId,
      [MEMORY.MEMORY_HAUL_RESOURCE]: RESOURCE_ENERGY,
      [MEMORY.MEMORY_HAUL_AMOUNT]: towerFree,
      [MEMORY.MEMORY_HAUL_DROPOFF]: tower.id,
    };

    (this.orgRoom as any).sendRequest(TOPICS.HAUL_CORE_TASK, priority, details, ttl);

    trace.log('request energy', {priority, details, towerUsed, towerTotal});
  }
}
