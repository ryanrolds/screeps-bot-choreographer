/**
 * Formation/party logic
 *
 * Handles logic related to filling the group, relative positioning, moving in
 * formation, setting heals, and targets for a group of creeps. Attack and defense
 * logic use this to abstract away creep handling.
 *
 */


import * as _ from 'lodash';
import {Kingdom} from "./org.kingdom";
import {RunnableResult, running, terminate} from "./os.process";
import {thread, ThreadFunc} from './os.thread';
import {Tracer} from './lib.tracing';
import {TOPIC_SPAWN} from './constants.topics';
import * as MEMORY from './constants.memory'
import {Colony} from './org.colony';
import {WarPartyTarget} from './runnable.warparty';

const REQUEST_PARTY_MEMBER_TTL = 25;
const MAX_PARTY_SIZE = 4;

const DEFAULT_FORMATION = [
  {x: 0, y: 0},
  {x: 1, y: 0},
  {x: 0, y: -1},
  {x: 1, y: -1},
];

const DIRECTION_OFFSET = {
  [TOP]: {x: 0, y: -1},
  [TOP_RIGHT]: {x: 1, y: -1},
  [RIGHT]: {x: 1, y: 0},
  [BOTTOM_RIGHT]: {x: 1, y: 1},
  [BOTTOM]: {x: 0, y: 1},
  [BOTTOM_LEFT]: {x: -1, y: 1},
  [LEFT]: {x: -1, y: 0},
  [TOP_LEFT]: {x: -1, y: -1},
}

export default class PartyRunnable {
  id: string;
  colony: Colony;
  formation: {x: number, y: number}[];
  position: RoomPosition;
  role: string;
  minEnergy: number;
  priority: number;
  requestCreepTTL: number;
  isDone: boolean;
  deployTicks: number;

  threadRequestCreeps: ThreadFunc;

  constructor(id: string, colony: Colony, position: RoomPosition, role: string, minEnergy: number,
    priority: number, ttl: number) {
    this.id = id;
    this.colony = colony;
    this.role = role;
    this.minEnergy = minEnergy;
    this.priority = priority;
    this.requestCreepTTL = ttl;
    this.isDone = false;
    this.deployTicks = 0;

    this.formation = DEFAULT_FORMATION;
    this.setPosition(position);

    this.threadRequestCreeps = thread('request_creeps', REQUEST_PARTY_MEMBER_TTL)(this.requestCreeps.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('party_run');

    // TODO possible race condition with outer layer and this
    const creeps = this.getAssignedCreeps();

    if (this.isDone) {
      trace.log("party done, cleaning up");

      // TODO recycle
      creeps.forEach((creep) => {
        creep.suicide();
      });

      trace.end();

      return terminate();
    }

    trace.log('party run', {
      id: this.id,
      position: this.position,
      deployTicks: this.deployTicks,
      creeps: creeps.map(creep => creep.name),
    });

    if (!Game.flags['debug']) {
      this.threadRequestCreeps(trace, kingdom);
    } else {
      trace.log('in debug mode, not spawning');
    }

    // TODO first four should be in formation, remaining should be behind
    creeps.forEach((creep, idx) => {
      idx = idx % 4;
      const x = _.max([_.min([this.position.x + this.formation[idx].x, 49]), 0]);
      const y = _.max([_.min([this.position.y + this.formation[idx].y, 49]), 0]);
      const roomName = this.position.roomName;

      trace.log('setting creep position', {name: creep.name, x, y, roomName});

      creep.memory[MEMORY.MEMORY_POSITION_X] = x;
      creep.memory[MEMORY.MEMORY_POSITION_Y] = y;
      creep.memory[MEMORY.MEMORY_POSITION_ROOM] = roomName;
    });

    trace.end();

    return running();
  }

  done() {
    this.isDone = true;
  }

  getPosition() {
    return this.position;
  }

  inPosition(position: RoomPosition, trace: Tracer) {
    let inPosition = true;

    const visual = new RoomVisual();

    const showVisuals = global.LOG_WHEN_ID === this.id;
    if (showVisuals) {
      visual.rect(position.x - 0.5, position.y - 1.5, 2, 2);
    }

    this.getAssignedCreeps().slice(0, 4).forEach((creep, idx) => {
      if (creep.fatigue > 0) {
        trace.log("not ready: fatigued", {creepName: creep.name, fatigue: creep.fatigue});
        inPosition = false;

        if (showVisuals) {
          visual.text("F", creep.pos.x, creep.pos.y + 0.5, {
            color: (idx) ? '#0000FF' : '#FFFFFF',
          });
        }

        return;
      }

      const x = _.max([_.min([this.position.x + this.formation[idx].x, 49]), 0]);
      const y = _.max([_.min([this.position.y + this.formation[idx].y, 49]), 0]);
      const roomName = this.position.roomName;

      if (creep.pos.x !== x || creep.pos.y !== y || creep.pos.roomName !== roomName) {
        trace.log("not ready: out of position", {
          creepName: creep.name,
          creepPos: creep.pos,
          desired: {x, y, roomName},
        });
        inPosition = false;

        /*
        if (creep.pos.getRangeTo(this.position) < 5) {
          trace.log("not ready: out of position", {
            creepName: creep.name,
            creepPos: creep.pos,
            desired: {x, y, roomName},
          });

          inPosition = false;
        } else {
          trace.log("far out of position, not halting", {
            creepName: creep.name,
            creepPos: creep.pos,
            desired: {x, y, roomName},
          });
        }
        */

        if (showVisuals) {
          visual.text("O", creep.pos.x, creep.pos.y + 0.5);
        }
        return;
      }

      if (showVisuals) {
        visual.text("R", creep.pos.x, creep.pos.y + 0.5);
      }
    });

    return inPosition;
  }

  onEdge(position: RoomPosition) {
    return position.x < 1 || position.x > 48 || position.y < 1 || position.y > 48;
  }

  shiftPosition(position: RoomPosition, direction: DirectionConstant): RoomPosition {
    const x = position.x + DIRECTION_OFFSET[direction].x;
    const y = position.y + DIRECTION_OFFSET[direction].y;
    return new RoomPosition(x, y, position.roomName);
  }

  isBlocked(position: RoomPosition, trace: Tracer): boolean {
    let structures: (Terrain | Structure)[] = [];

    let positions = this.formation.map((offset) => {
      const x = _.min([_.max([position.x + offset.x, 0]), 49]);
      const y = _.min([_.max([position.y + offset.y, 0]), 49]);
      return new RoomPosition(x, y, position.roomName);
    });

    positions.forEach((position) => {
      structures = structures.concat(position.lookFor(LOOK_STRUCTURES))
        .filter((structure: Structure) => {
          return structure.structureType !== STRUCTURE_ROAD;
        });

      structures = structures.concat(position.lookFor(LOOK_TERRAIN))
        .filter((terrain: Terrain) => {
          return terrain === "wall";
        });
    });

    trace.log("blocking structures", (structures));

    return structures.length > 0;
  }

  getBlockingObjects(direction: DirectionConstant, position: RoomPosition, trace: Tracer): WarPartyTarget[] {
    let objects: WarPartyTarget[] = [];

    let positions = this.formation.map((offset) => {
      const x = _.min([_.max([position.x + offset.x, 0]), 49]);
      const y = _.min([_.max([position.y + offset.y, 0]), 49]);
      trace.log("get blocking at position", {position, direction, offset, x, y});
      return new RoomPosition(x, y, position.roomName);
    });

    // We cannot lookFor in a room that is not loaded
    if (Game.rooms[position.roomName]) {
      positions.forEach((position) => {
        // Structures can block
        objects = objects.concat(position.lookFor(LOOK_STRUCTURES))
          .filter((structure: Structure) => {
            return structure.structureType !== STRUCTURE_ROAD;
          });

        // Creeps not in the party can block
        objects = objects.concat(position.lookFor(LOOK_CREEPS))
          .filter((creep: Creep) => {
            return this.getAssignedCreeps().indexOf(creep) === -1;
          });
      });
    }

    return objects;
  }

  setRole(role: string) {
    this.role = role;
  }

  setFormation(formation: {x: number, y: number}[]) {
    this.formation = formation;
  }

  setMinEnergy(minEnergy: number) {
    this.minEnergy = minEnergy;
  }

  setPosition(position: RoomPosition) {
    this.position = position;
  }

  setTarget(targets: WarPartyTarget[], trace: Tracer): WarPartyTarget {
    const target = _.find(targets, (target) => {
      return this.position.getRangeTo(target) <= 3;
    });

    if (target) {
      Game.map.visual.line(this.position, target.pos, {color: '#FF0000'});
    } else {
      trace.log("no targets in range");
      return null;
    }

    trace.log("setting targets", {target});

    const creeps = this.getAssignedCreeps();
    creeps.forEach((creep) => {
      creep.memory[MEMORY.MEMORY_ATTACK] = target?.id;
    });

    return target;
  }

  setHeal(trace: Tracer) {
    const creeps = this.getAssignedCreeps();
    if (!creeps.length) {
      return;
    }

    // Locate most damaged creep and heal
    const healOrder = _.sortBy(creeps, (creep) => {
      return creep.hits / creep.hitsMax;
    });

    let targetId = null;
    if (healOrder.length && healOrder[0].hits < healOrder[0].hitsMax) {
      targetId = healOrder[0].id;
    }

    const damagePercent = healOrder[0].hits / healOrder[0].hitsMax;

    creeps.forEach((creep, idx) => {
      creep.memory[MEMORY.MEMORY_HEAL] = null;

      if ((idx === 0 && damagePercent < 0.5) || (idx === 1 && damagePercent < 0.75)) {
        creep.memory[MEMORY.MEMORY_HEAL] = targetId;
      } else if (idx >= 2 && damagePercent < 1) {
        creep.memory[MEMORY.MEMORY_HEAL] = targetId;
      }
    });
  }

  getAssignedCreeps(): Creep[] {
    const creeps = Object.values(Game.creeps).filter((creep) => {
      return creep.memory[MEMORY.MEMORY_PARTY_ID] === this.id;
    });

    let quad = _.sortBy(creeps, 'ttl').slice(0, 4);
    /*
    quad = quad.filter(creep => !creep.spawning);
    quad = _.sortBy(quad, (creep) => {
      return creep.body.filter(part => part.type === HEAL).reduce((acc, part) => {
        if (part.boost) {
          acc += HEAL_POWER * BOOSTS[HEAL][part.boost][HEAL];
        } else {
          acc += HEAL_POWER;
        }

        return acc;
      }, 0)
    })
    */

    return [].concat(quad, creeps.slice(4));
  }

  getColony(): Colony {
    return this.colony;
  }

  requestCreeps(trace: Tracer, kingdom: Kingdom) {
    const spawns = Game.rooms[this.colony.primaryRoomId]?.find(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_SPAWN,
    });
    if (!spawns || !spawns.length) {
      trace.log("no spawns found");
      return;
    }

    const path = PathFinder.search(this.position, spawns[0].pos, {
      maxOps: 4000,
    });

    // TODO need to calculate plains cost
    const plainsCost = 2;
    // path length * move cost/ticks
    const travelTime = path.path.length * plainsCost
    // 150 for the 50 parts
    const buildTime = 150;
    this.deployTicks = travelTime + buildTime;
    if (path.incomplete) {
      this.deployTicks += 200
    }

    trace.log("deploy time", {
      pathLength: path.path.length,
      pathIncomplete: path.incomplete,
      plainsCost,
    })

    const creeps = this.getAssignedCreeps();
    const freshCreeps = creeps.filter((creep) => {
      return creep.spawning || (creep.ticksToLive > this.deployTicks);
    })

    if (freshCreeps.length >= MAX_PARTY_SIZE) {
      trace.log("we have enough creeps", {
        freshCreeps: freshCreeps.map(creep => creep.name),
        deployTicks: this.deployTicks,
        lowestTTL: _.min(
          creeps.filter(creep => creep.ticksToLive)
            .map(creep => creep.ticksToLive)
        ),
      });
      return;
    }

    // Determine creeps position at rally point
    const idx = _.max([creeps.length - 1, 0]) % 4;
    const x = this.position.x + this.formation[idx].x;
    const y = this.position.y + this.formation[idx].y;
    const roomName = this.position.roomName;

    const details = {
      role: this.role,
      [MEMORY.SPAWN_MIN_ENERGY]: 2000, // TODO add to constructor
      memory: {
        [MEMORY.MEMORY_PARTY_ID]: this.id,
        // Tell creep to move to it's rally point position
        [MEMORY.MEMORY_POSITION_X]: x,
        [MEMORY.MEMORY_POSITION_Y]: y,
        [MEMORY.MEMORY_POSITION_ROOM]: roomName,
      },
    };

    trace.log('requesting creep', {
      colonyId: this.colony.id,
      role: this.role,
      priority: this.priority,
      deployTicks: this.deployTicks,
      ttl: this.requestCreepTTL,
      details,
    });

    (this.colony as any).sendRequest(TOPIC_SPAWN, this.priority, details, this.requestCreepTTL);
  }
}
