import * as _ from 'lodash';
import {Kingdom} from "./org.kingdom";
import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {WORKER_DEFENDER_DRONE} from './constants.creeps'
import {PRIORITY_DEFENDER} from "./constants.priorities";
import {TOPIC_SPAWN} from './constants.topics';
import * as MEMORY from './constants.memory'
import TOPICS from './constants.topics';
import Room from './org.room';


const REQUEST_PARTY_MEMBER_TTL = 30;
const NO_TARGET_TTL = 20;

const FORMATION = [
  {x: -1, y: 1},
  {x: 0, y: 1},
  {x: -1, y: 0},
  {x: 0, y: 0},
];

export default class DefensePartyRunnable {
  id: string;
  flagId: string;
  position: RoomPosition;
  creeps: Creep[];
  creepRequestTTL: number;
  noTargetTTL: number;

  constructor(id: string, flagId: string, position: RoomPosition) {
    this.id = id;
    this.flagId = flagId;
    this.position = position;
    this.creepRequestTTL = 0;
    this.noTargetTTL = 0;
    this.creeps = [];
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);
    this.creeps = this.getAssignedCreeps();

    trace.log('defense party run', {
      id: this.id,
      creeps: this.creeps.map(creep => creep.id),
      flagId: this.flagId,
      position: this.position,
      creepRequestTTL: this.creepRequestTTL,
      noTargetTTL: this.noTargetTTL,
    });

    this.fillParty(kingdom, trace);

    if (!this.creeps.length) {
      return running();
    }

    const room = Game.rooms[this.position.roomName];
    if (!room) {
      return running();
    }

    let flag = null;
    if (this.flagId) {
      flag = Game.flags[this.flagId];
      if (!flag) {
        this.creeps.forEach((creep) => {
          //creep.suicide();
        });

        return terminate();
      }
    } else {
      return terminate();
    }

    // Consume priorities
    const orgRoom: Room = kingdom.getRoomByName(this.position.roomName);
    const targetRequests: Creep[] = (orgRoom as any).getFilteredRequests(TOPICS.PRIORITY_TARGETS, (request) => {
      return request.details.roomName === room.name;
    }).map((request) => {
      return Game.getObjectById(request.details.id);
    }).filter((creep) => {
      return creep;
    });

    trace.log('target requests', {targetRequests: targetRequests.map(target => target.id)});

    let destination = this.position;
    if (targetRequests.length) {
      this.noTargetTTL = NO_TARGET_TTL;
      destination = targetRequests[0].pos
    } else {
      this.noTargetTTL -= 1;
      if (this.noTargetTTL < 0 && flag) {
        destination = flag.pos;
      }
    }
    this.position = destination;

    trace.log('destination', {destination});

    const leader = this.creeps[0];
    trace.log('leader', {leader: leader.id});

    // Check if we are ready to move closer to the destination
    const creepsInPosition = this.creeps.reduce((acc, creep) => {
      const inRange = creep.pos.getRangeTo(this.creeps[0]) <= 1;
      creep.memory[MEMORY.MEMORY_DEFENSE_IN_POSITION] = inRange;
      return acc + ((inRange && creep.fatigue === 0) ? 1 : 0);
    }, 0);
    const partyInPosition = creepsInPosition / this.creeps.length >= 0.5;

    if (partyInPosition && leader) {
      const path = leader.pos.findPathTo(destination, {ignoreCreeps: false});
      if (path.length) {
        const step = path[0]
        const nextPosition = new RoomPosition(step.x, step.y, leader.room.name);
        this.setPosition(nextPosition, trace);
      }
    }

    trace.log('hostile targets', {targetRequests});

    this.setTarget(targetRequests, trace)
    this.setHeal(trace)

    return running();
  }

  fillParty(kingdom: Kingdom, trace: Tracer): boolean {
    this.creepRequestTTL--;
    if (this.creepRequestTTL < 1) {
      this.creepRequestTTL = REQUEST_PARTY_MEMBER_TTL;
      this.requestDefenders(kingdom, 4 - this.creeps.length, trace);
    }

    return false;
  }

  setPosition(position: RoomPosition, trace: Tracer) {
    this.position = position;

    this.creeps.forEach((creep, idx) => {
      const x = position.x + FORMATION[idx].x;
      const y = position.y + FORMATION[idx].y;
      const roomName = position.roomName;

      trace.log('setting creep position', {name: creep.name, x, y, roomName});

      creep.memory[MEMORY.MEMORY_POSITION_X] = x;
      creep.memory[MEMORY.MEMORY_POSITION_Y] = y;
      creep.memory[MEMORY.MEMORY_POSITION_ROOM] = roomName;
    });
  }

  setTarget(targets: Creep[], trace: Tracer): boolean {
    const target = _.find(targets, (creep) => {
      return this.position.getRangeTo(creep) <= 3;
    });

    if (target) {
      Game.map.visual.line(this.position, target.pos, {color: '#FF0000'});
    }

    this.creeps.forEach((creep) => {
      creep.memory[MEMORY.MEMORY_ATTACK] = target?.id;
    });

    return false;
  }

  setHeal(trace: Tracer) {
    // Locate most damaged creep and heal
    const healOrder = _.sortBy(this.creeps, (creep) => {
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

  getAssignedCreeps() {
    const creeps = Object.values(Game.creeps).filter((creep) => {
      return creep.memory[MEMORY.MEMORY_DEFENSE_PARTY] === this.id;
    })

    return _.sortBy(creeps, 'ttl')
  }

  requestDefenders(kingdom: Kingdom, numToRequest: number, trace: Tracer) {
    for (let i = 0; i < numToRequest; i++) {
      // Determine creeps position at rally point
      const idx = i + this.creeps.length;
      const x = this.position.x + FORMATION[idx].x;
      const y = this.position.y + FORMATION[idx].y;
      const roomName = this.position.roomName;

      const details = {
        role: WORKER_DEFENDER_DRONE,
        memory: {
          [MEMORY.MEMORY_DEFENSE_PARTY]: this.id,
          // Tell creep to move to it's rally point position
          [MEMORY.MEMORY_POSITION_X]: x,
          [MEMORY.MEMORY_POSITION_Y]: y,
          [MEMORY.MEMORY_POSITION_ROOM]: roomName,
        },
      };

      const room = kingdom.getRoomByName(roomName);
      if (!room) {
        trace.log('not requesting creeps: room not in colony');
        return;
      }

      trace.log('requesting creep', {details});

      (room as any).sendRequest(TOPIC_SPAWN, PRIORITY_DEFENDER, details, REQUEST_PARTY_MEMBER_TTL);
    }
  }
}
