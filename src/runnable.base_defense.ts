/**
 * Base defense logic
 *
 * Controls the base alert level. Consumes status updates from base's rooms and requests
 * production of defenders.
 *
 * Requirements:
 *   - Consume defense status updates base defense stream
 *   - Request defenders when hostiles are present
 *   - Old threats expire when threat is not longer present
 *
 * TODO:
 *   - Produce base alert level updates to base stream
 *   - Determine number of defenders using the hostile score
 */
import {creepIsFresh} from "./behavior.commute";
import {BaseConfig} from "./config";
import {WORKER_DEFENDER} from "./constants.creeps";
import {MEMORY_ASSIGN_ROOM, MEMORY_ASSIGN_ROOM_POS, MEMORY_BASE, MEMORY_ROLE} from "./constants.memory";
import {PRIORITY_DEFENDER} from "./constants.priorities";
import {Consumer} from "./lib.event_broker";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {AlertLevel} from "./org.room";
import {PersistentMemory} from "./os.memory";
import {sleeping, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getBaseSpawnTopic} from "./topics.base";

export const BaseDefenseStatusSet = 'set';

export function getBaseRoomStatusStream(baseId: string): string {
  return `base_${baseId}_defense`;
}

export type RoomDefenseStatus = {
  time: number;
  alertLevel: AlertLevel;
  invaderScore: RoomCreepScore;
  invaderCore: boolean;
  hostileScore: RoomCreepScore;
  myScore: RoomCreepScore;
}

export type RoomCreepScore = {
  creeps: number;
  heal: number;
  ranged: number;
  melee: number;
  work: number;
  carry: number;
  claim: number;
}

const PROCESS_EVENTS_TTL = 20;
const REQUEST_DEFENDERS_TTL = 20;
const REQUEST_DEFENDERS_DELAY = 20;
const HOSTILE_PRESENCE_TTL = 200;

const MAX_DEFENDERS = 4;

export class BaseDefense extends PersistentMemory implements Runnable {
  baseId: string;

  roomStatuses: Record<string, RoomDefenseStatus>;

  roomStatusConsumer: Consumer;
  threadProcessEvents: ThreadFunc;

  threadRequestDefenders: ThreadFunc;

  constructor(baseId: string) {
    super(`base_${baseId}_defense`);

    this.baseId = baseId;

    this.roomStatuses = {};

    this.roomStatusConsumer = null;
    this.threadProcessEvents = thread('process_events', PROCESS_EVENTS_TTL)(this.processEvents.bind(this));

    this.threadRequestDefenders = thread('request_defenders_thread',
      REQUEST_DEFENDERS_TTL)(this.checkIfDefendersNeeded.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    if (!this.roomStatusConsumer) {
      const streamId = getBaseRoomStatusStream(this.baseId);
      this.roomStatusConsumer = kingdom.getBroker().getStream(streamId).addConsumer('base');
    }

    const base = kingdom.getPlanner().getBaseConfigById(this.baseId);
    if (!base) {
      trace.error('base not found, terminating', {baseId: this.baseId});
      return terminate();
    }

    this.threadProcessEvents(trace, kingdom, base);

    // Check if we need to request defenders (was the room hostile last time we saw it?)
    this.threadRequestDefenders(trace, kingdom, base);

    // Cleanup old room statuses
    _.each(this.roomStatuses, (status, id) => {
      if (Game.time - status.time > HOSTILE_PRESENCE_TTL) {
        delete this.roomStatuses[id];
      }
    });

    trace.notice('base room statuses', {roomStatuses: this.roomStatuses});

    return sleeping(20);
  }

  processEvents(trace: Tracer, kingdom: Kingdom, base: BaseConfig): void {
    this.roomStatusConsumer.getEvents().forEach((event) => {
      const status = event.data as RoomDefenseStatus;
      const id = event.key;

      this.roomStatuses[id] = status;
    });
  }

  checkIfDefendersNeeded(trace: Tracer, kingdom: Kingdom, base: BaseConfig): void {
    const defenders = kingdom.getBaseCreeps(base.id).filter((creep) => {
      return creep.memory[MEMORY_ROLE] === 'defender' && creepIsFresh(creep);
    })

    trace.log('existing defenders', {defenders: defenders.length, MAX_DEFENDERS});

    const neededDefenders = MAX_DEFENDERS - defenders.length;
    if (neededDefenders <= 0) {
      trace.log('do not need defenders: full');
      return;
    }

    trace.log('need defenders:', {neededDefenders});

    /*
    const enemyPresent = this.hostiles.length || this.invaderCores.length;
    const enemyPresentRecently = Game.time - this.hostileTime < HOSTILE_PRESENCE_TTL;
    if (!enemyPresent || !enemyPresentRecently) {
      trace.log('do not request defender: room is quiet');
      return;
    }

    trace.log('checking if we need defenders to handle hostile presence', {
      enemyPresent,
      enemyPresentRecently,
      hostileTime: this.hostileTime,
      defendersLost: this.defendersLost,
    });

    let controller = null;
    if (this.room && this.room.controller) {
      controller = this.room.controller;
    }

    if (controller && (controller.safeMode && controller.safeMode > 250)) {
      trace.log('do not request defenders: in safe mode', {safeMode: controller.safeMode});
      return;
    }

    if (!this.isPrimary && this.defendersLost >= 3) {
      trace.log('do not request defender: we have lost too many defenders');
    }

    const pastDelay = Game.time - this.hostileTime >= REQUEST_DEFENDERS_DELAY;
    if (!pastDelay) {
      trace.log('do not request defender: waiting to see if they leave', {
        pastDelay,
        age: Game.time - this.hostileTime,
        REQUEST_DEFENDERS_DELAY,
      });
      return;
    }

    for (let i = 0; i < neededDefenders; i++) {
      this.requestDefender(kingdom, base, this.lastHostilePosition, true, trace);
    }
    */
  }

  requestDefender(kingdom: Kingdom, base: BaseConfig, position: RoomPosition,
    spawnDefenders: boolean, trace: Tracer): void {
    trace.log('requesting defender', {position, spawnDefenders});

    kingdom.sendRequest(getBaseSpawnTopic(base.id), PRIORITY_DEFENDER, {
      role: WORKER_DEFENDER,
      spawn: spawnDefenders,
      memory: {
        [MEMORY_ASSIGN_ROOM]: position.roomName,
        [MEMORY_ASSIGN_ROOM_POS]: position,
        [MEMORY_BASE]: base.id,
      },
    }, REQUEST_DEFENDERS_TTL);
  }
}
