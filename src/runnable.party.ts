import * as _ from 'lodash';
import {Kingdom} from "./org.kingdom";
import {RunnableResult, running, terminate} from "./os.process";
import {thread} from './os.thread';
import {Tracer} from './lib.tracing';
import {TOPIC_SPAWN} from './constants.topics';
import * as MEMORY from './constants.memory'
import Colony from './org.colony';

const REQUEST_PARTY_MEMBER_TTL = 25;
const MAX_PARTY_SIZE = 4;

const FORMATION = [
  {x: 0, y: 0},
  {x: 1, y: 0},
  {x: 0, y: -1},
  {x: 1, y: -1},
];

export default class PartyRunnable {
  id: string;
  colony: Colony;
  position: RoomPosition;
  path: PathFinderPath;
  pathIndex: number;
  role: string;
  priority: number;
  requestCreepTTL: number;
  isMarshalled: boolean;
  isDone: boolean;

  creeps: Creep[];
  threadRequestCreeps: any;

  constructor(id: string, colony: Colony, position: RoomPosition, role: string, priority: number, ttl: number) {
    this.id = id;
    this.colony = colony;
    this.creeps = [];
    this.role = role;
    this.priority = priority;
    this.requestCreepTTL = ttl;
    this.isDone = false;

    this.setPosition(position);

    this.threadRequestCreeps = thread(REQUEST_PARTY_MEMBER_TTL, null, null)(this.requestCreeps.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);
    this.creeps = this.getAssignedCreeps();

    if (this.isDone) {
      trace.notice("party done, cleaning up");

      // TODO recycle
      this.creeps.forEach((creep) => {
        creep.suicide();
      });

      return terminate();
    }

    trace.log('party run', {
      id: this.id,
      creeps: this.creeps.map(creep => creep.name),
      position: this.position,
    });

    this.threadRequestCreeps(kingdom, trace);

    trace.log('position', {position: this.position});

    this.creeps.forEach((creep, idx) => {
      const x = _.max([_.min([this.position.x + FORMATION[idx].x, 49]), 0]);
      const y = _.max([_.min([this.position.y + FORMATION[idx].y, 49]), 0]);
      const roomName = this.position.roomName;

      trace.log('setting creep position', {name: creep.name, x, y, roomName});

      creep.memory[MEMORY.MEMORY_POSITION_X] = x;
      creep.memory[MEMORY.MEMORY_POSITION_Y] = y;
      creep.memory[MEMORY.MEMORY_POSITION_ROOM] = roomName;
    });

    return running();
  }

  done() {
    this.isDone = true;
  }

  getPosition() {
    return this.position;
  }

  inPosition(trace: Tracer) {
    let inPosition = true;

    this.getAssignedCreeps().forEach((creep, idx) => {
      if (creep.fatigue > 0) {
        trace.log("not ready: fatigued", {creepName: creep.name, fatigue: creep.fatigue});
        inPosition = false;
        return;
      }

      const x = _.max([_.min([this.position.x + FORMATION[idx].x, 49]), 0]);
      const y = _.max([_.min([this.position.y + FORMATION[idx].y, 49]), 0]);
      const roomName = this.position.roomName;

      if (creep.pos.x !== x || creep.pos.y !== y || creep.pos.roomName !== roomName) {
        trace.log("not ready: out of position", {creepName: creep.name, creepPos: creep.pos, desired: {x, y, roomName}});
        inPosition = false;
        return;
      }
    });

    return inPosition;
  }

  onEdge() {
    return this.position.x < 1 || this.position.x > 48 || this.position.y < 1 || this.position.y > 48;
  }

  setPosition(position: RoomPosition) {
    this.position = position;
  }

  setTarget(targets: (Creep | Structure)[], trace: Tracer): boolean {
    const target = _.find(targets, (target) => {
      return this.position.getRangeTo(target) <= 2;
    });

    if (target) {
      Game.map.visual.line(this.position, target.pos, {color: '#FF0000'});
    }

    trace.log("setting targets", {target});

    this.creeps.forEach((creep) => {
      creep.memory[MEMORY.MEMORY_ATTACK] = target?.id;
    });

    return false;
  }

  setHeal(trace: Tracer) {
    // Locate most damaged creep and heal
    const healOrder = _.sortBy(this.getAssignedCreeps(), (creep) => {
      return creep.hits / creep.hitsMax;
    });

    let targetId = null;
    if (healOrder.length && healOrder[0].hits < healOrder[0].hitsMax) {
      targetId = healOrder[0].id;
    }

    this.creeps.forEach((creep) => {
      creep.memory[MEMORY.MEMORY_HEAL] = targetId;
    });
  }

  getCreeps() {
    return this.creeps;
  }

  getAssignedCreeps() {
    const creeps = Object.values(Game.creeps).filter((creep) => {
      return creep.memory[MEMORY.MEMORY_PARTY_ID] === this.id;
    })

    return _.sortBy(creeps, 'ttl')
  }

  getColony(): Colony {
    return this.colony;
  }

  requestCreeps(kingdom: Kingdom, trace: Tracer) {
    if (this.creeps.length >= MAX_PARTY_SIZE) {
      return;
    }

    // Determine creeps position at rally point
    const idx = this.creeps.length;

    trace.log("debug x of undefined", {
      id: this.id,
      creepNames: this.creeps.map(creep => creep.name),
      idx,
      FORMATION,
    });

    const x = this.position.x + FORMATION[idx].x;
    const y = this.position.y + FORMATION[idx].y;
    const roomName = this.position.roomName;

    const details = {
      role: this.role,
      [MEMORY.SPAWN_MIN_ENERGY]: 4000, // TODO add to constructor
      memory: {
        [MEMORY.MEMORY_PARTY_ID]: this.id,
        // Tell creep to move to it's rally point position
        [MEMORY.MEMORY_POSITION_X]: x,
        [MEMORY.MEMORY_POSITION_Y]: y,
        [MEMORY.MEMORY_POSITION_ROOM]: roomName,
      },
    };

    trace.notice('requesting creep', {
      colonyId: this.colony.id,
      role: this.role,
      priority: this.priority,
      ttl: this.requestCreepTTL,
      details,
    });

    (this.colony as any).sendRequest(TOPIC_SPAWN, this.priority, details, this.requestCreepTTL);
  }
}
