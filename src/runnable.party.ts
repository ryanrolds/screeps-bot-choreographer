/**
 * Formation/party logic
 *
 * Handles logic related to filling the group, relative positioning, moving in
 * formation, setting heals, and targets for a group of creeps. Attack and defense
 * logic use this to abstract away creep handling.
 *
 */
import * as _ from 'lodash';
import {Base, BaseThreadFunc, threadBase} from './base';
import * as MEMORY from './constants.memory';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {running, terminate} from './os.process';
import {RunnableResult} from './os.runnable';
import {createSpawnRequest, getBaseSpawnTopic} from './runnable.base_spawning';
import {WarPartyTarget} from './runnable.warparty';

const REQUEST_PARTY_MEMBER_TTL = 25;
const MAX_PARTY_SIZE = 4;
const MAX_PREVIOUS_POSITIONS = 6;

export const FORMATION_QUAD = 'quad';
export const FORMATION_SINGLE_FILE = 'single_file';
export type FORMATION_TYPE = typeof FORMATION_QUAD | typeof FORMATION_SINGLE_FILE;

const DIRECTION_2BY2_FORMATION = {
  [TOP]: [
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
  ],
  [TOP_RIGHT]: [
    {x: 1, y: -1}, // TR
    {x: 0, y: -1}, // TL
    {x: 1, y: 0}, // BR
    {x: 0, y: 0}, // BL
  ],
  [RIGHT]: [
    {x: 1, y: -1}, // TR
    {x: 1, y: 0}, // BR
    {x: 0, y: -1}, // TL
    {x: 0, y: 0}, // BL
  ],
  [BOTTOM_RIGHT]: [
    {x: 1, y: 0}, // BR
    {x: 1, y: -1}, // TR
    {x: 0, y: -1}, // TL
    {x: 0, y: 0}, // BL
  ],
  [BOTTOM]: [
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
  ],
  [BOTTOM_LEFT]: [
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
  ],
  [LEFT]: [
    {x: 0, y: -1}, // TL
    {x: 0, y: 0}, // BL
    {x: 1, y: -1}, // TR
    {x: 1, y: 0}, // BR
  ],
  [TOP_LEFT]: [
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
  ],
};

const DIRECTION_OFFSET = {
  [TOP]: {x: 0, y: -1},
  [TOP_RIGHT]: {x: 1, y: -1},
  [RIGHT]: {x: 1, y: 0},
  [BOTTOM_RIGHT]: {x: 1, y: 1},
  [BOTTOM]: {x: 0, y: 1},
  [BOTTOM_LEFT]: {x: -1, y: 1},
  [LEFT]: {x: -1, y: 0},
  [TOP_LEFT]: {x: -1, y: -1},
};

export default class PartyRunnable {
  id: string;
  baseId: string;
  formation: FORMATION_TYPE;
  position: RoomPosition;
  role: string;
  parts: BodyPartConstant[]
  minEnergy: number;
  priority: number;
  requestCreepTTL: number;
  isDone: boolean;
  deployTicks: number;
  direction: DirectionConstant;

  // when in single file formation, keep last 4 positions
  previousPositions: RoomPosition[];

  threadRequestCreeps: BaseThreadFunc;

  constructor(id: string, baseId: string, position: RoomPosition, role: string,
    parts: BodyPartConstant[], minEnergy: number, priority: number, ttl: number) {
    this.id = id;
    this.baseId = baseId;
    this.role = role;
    this.parts = parts;
    this.minEnergy = minEnergy;
    this.priority = priority;
    this.requestCreepTTL = ttl;
    this.isDone = false;
    this.deployTicks = 0;
    this.previousPositions = [];

    this.setPosition(position);
    this.setFormation(FORMATION_QUAD);
    this.setDirection(TOP);

    this.previousPositions = [this.position];

    this.threadRequestCreeps = threadBase('request_creeps', REQUEST_PARTY_MEMBER_TTL)(this.requestCreeps.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('party_run');

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('base not found', {baseId: this.baseId});
      trace.end();
      return terminate();
    }

    // TODO possible race condition with outer layer and this
    const creeps = this.getAssignedCreeps();

    if (this.isDone) {
      trace.info('party done, cleaning up');

      // TODO recycle
      creeps.forEach((creep) => {
        creep.suicide();
      });

      trace.end();
      return terminate();
    }

    trace.info('party run', {
      id: this.id,
      position: this.position,
      deployTicks: this.deployTicks,
      creeps: creeps.map((creep) => creep.name),
    });

    if (!Game.flags['debug']) {
      this.threadRequestCreeps(trace, kernel, base);
    } else {
      trace.info('in debug mode, not spawning');
    }

    this.updateCreepPositions(creeps, trace);

    trace.end();
    return running();
  }

  updateCreepPositions(creeps: Creep[], trace: Tracer) {
    if (this.formation === FORMATION_SINGLE_FILE) {
      creeps.forEach((creep, idx) => {
        let position = this.position;
        if (this.previousPositions[idx]) {
          position = this.previousPositions[idx];
        }

        trace.info('setting creep position in single file', {name: creep.name, idx, position});

        creep.memory[MEMORY.MEMORY_POSITION_X] = position.x;
        creep.memory[MEMORY.MEMORY_POSITION_Y] = position.y;
        creep.memory[MEMORY.MEMORY_POSITION_ROOM] = position.roomName;
      });
    } else if (this.formation === FORMATION_QUAD) {
      const quadPositions = this.getCreepOffsets();
      // TODO first four should be in formation, remaining should be behind
      // Can possibly use 3rd and grater previous positions
      creeps.forEach((creep, idx) => {
        idx = idx % 4;
        const x = _.max([_.min([this.position.x + quadPositions[idx].x, 49]), 0]);
        const y = _.max([_.min([this.position.y + quadPositions[idx].y, 49]), 0]);
        const roomName = this.position.roomName;

        trace.info('setting creep position in quad', {name: creep.name, x, y, roomName});

        creep.memory[MEMORY.MEMORY_POSITION_X] = x;
        creep.memory[MEMORY.MEMORY_POSITION_Y] = y;
        creep.memory[MEMORY.MEMORY_POSITION_ROOM] = roomName;
      });
    } else {
      trace.error('unknown formation', this.formation);
    }
  }

  done() {
    this.isDone = true;
  }

  getPosition() {
    return this.position;
  }

  getCreepPosition(idx: number, trace: Tracer): RoomPosition {
    // Set to current position
    let x = this.position.x;
    let y = this.position.y;
    let roomName = this.position.roomName;

    if (this.formation === FORMATION_SINGLE_FILE) {
      // only update position if we have a previous position
      if (this.previousPositions[idx]) {
        x = this.previousPositions[idx].x;
        y = this.previousPositions[idx].y;
        roomName = this.previousPositions[idx].roomName;
      }
    } else if (this.formation === FORMATION_QUAD) {
      const quadPositions = this.getCreepOffsets();
      x = _.max([_.min([this.position.x + quadPositions[idx].x, 49]), 0]);
      y = _.max([_.min([this.position.y + quadPositions[idx].y, 49]), 0]);
      roomName = this.position.roomName;
    } else {
      trace.warn('unknown formation', this.formation);
    }

    return new RoomPosition(x, y, roomName);
  }

  inPosition(position: RoomPosition, trace: Tracer) {
    let inPosition = true;

    const visual = new RoomVisual();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const showVisuals = (global as any).LOG_WHEN_PID === this.id;
    if (showVisuals) {
      if (this.formation === FORMATION_QUAD) {
        visual.rect(position.x - 0.5, position.y - 1.5, 2, 2);
      }

      if (this.formation === FORMATION_SINGLE_FILE) {
        visual.rect(position.x - 0.5, position.y - 1.5, 2, 2);
      }
    }

    let positionBlocked = false;

    this.getAssignedCreeps().slice(0, 4).forEach((creep, idx) => {
      // if creep is on an edge, report it as ready
      if (creep.pos.x === 49 || creep.pos.x === 0 || creep.pos.y === 49 || creep.pos.y === 0) {
        trace.info('creep is at edge', {
          name: creep.name,
          pos: creep.pos,
        });

        if (showVisuals) {
          visual.text('E', creep.pos.x, creep.pos.y + 0.5, {
            color: (idx) ? '#0000FF' : '#FFFFFF',
          });
        }

        return;
      }

      if (creep.fatigue > 0) {
        trace.info('not ready: fatigued', {creepName: creep.name, fatigue: creep.fatigue});
        inPosition = false;

        if (showVisuals) {
          visual.text('F', creep.pos.x, creep.pos.y + 0.5, {
            color: (idx) ? '#0000FF' : '#FFFFFF',
          });
        }

        return;
      }

      const position = this.getCreepPosition(idx, trace);

      const terrain = position.lookFor(LOOK_TERRAIN);
      if (terrain.length > 0 && terrain[0] === 'wall') {
        if (showVisuals) {
          visual.text('W', position.x, position.y + 0.5);
        }

        trace.info('not ready: terrain', {
          name: creep.name,
          terrain: terrain,
          position: position,
          idx,
        });

        positionBlocked = true;
        return;
      }

      if (creep.pos.x !== position.x || creep.pos.y !== position.y ||
        creep.pos.roomName !== position.roomName) {
        trace.info('not ready: out of position', {
          creepName: creep.name,
          creepPos: creep.pos,
          desired: position,
          formation: this.formation,
          idx,
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
          visual.text('O', creep.pos.x, creep.pos.y + 0.5);
        }
        return;
      }

      trace.info('in position', {
        creepName: creep.name,
        creepPos: creep.pos,
        desired: position,
        formation: this.formation,
        idx,
      });

      if (showVisuals) {
        visual.text('R', creep.pos.x, creep.pos.y + 0.5);
      }
    });

    return positionBlocked || inPosition;
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
    let positions: RoomPosition[] = [];

    if (this.formation === FORMATION_SINGLE_FILE) {
      positions = [
        RoomPosition(position.x, position.y, position.roomName),
      ];
    } else {
      positions = this.getCreepOffsets().map((offset) => {
        const x = _.min([_.max([position.x + offset.x, 0]), 49]);
        const y = _.min([_.max([position.y + offset.y, 0]), 49]);
        return new RoomPosition(x, y, position.roomName);
      });
    }

    positions.forEach((position) => {
      structures = structures.concat(position.lookFor(LOOK_STRUCTURES))
        .filter((structure: Structure) => {
          return structure.structureType !== STRUCTURE_ROAD;
        });

      structures = structures.concat(position.lookFor(LOOK_TERRAIN))
        .filter((terrain: Terrain) => {
          return terrain === 'wall';
        });
    });

    trace.info('blocking structures', {structures});

    return structures.length > 0;
  }

  // Returns objects that are blocking the party
  getBlockingObjects(position: RoomPosition, _direction: DirectionConstant, _trace: Tracer): WarPartyTarget[] {
    let objects: WarPartyTarget[] = [];

    let positions: RoomPosition[] = [];

    if (this.formation === FORMATION_SINGLE_FILE) {
      positions = [
        new RoomPosition(
          _.min([_.max([position.x, 0]), 49]),
          _.min([_.max([position.y, 0]), 49]),
          position.roomName,
        ),
      ];
    } else if (this.formation === FORMATION_QUAD) {
      positions = this.getCreepOffsets().map((offset) => {
        const x = _.min([_.max([position.x + offset.x, 0]), 49]);
        const y = _.min([_.max([position.y + offset.y, 0]), 49]);
        return new RoomPosition(x, y, position.roomName);
      });
    }

    // We cannot lookFor in a room that is not loaded
    if (Game.rooms[position.roomName]) {
      positions.forEach((position) => {
        // Structures can block
        objects = objects.concat(position.lookFor(LOOK_STRUCTURES))
          .filter((structure: Structure) => {
            return structure.structureType !== STRUCTURE_ROAD && !(
              structure.structureType === STRUCTURE_RAMPART &&
              structure.room?.controller?.my
            );
          });
      });
    }

    return objects;
  }

  setRole(role: string) {
    this.role = role;
  }

  setParts(parts: BodyPartConstant[]) {
    this.parts = parts;
  }

  setFormation(formation: FORMATION_TYPE) {
    this.formation = formation;
  }

  getFormation(): FORMATION_TYPE {
    return this.formation;
  }

  getCreepOffsets(): {x: number, y: number}[] {
    if (this.formation === FORMATION_SINGLE_FILE) {
      return this.previousPositions;
    } else if (this.formation === FORMATION_QUAD) {
      return DIRECTION_2BY2_FORMATION[this.direction];
    } else {
      throw new Error('Unknown formation');
    }
  }

  getCreepPositions(): RoomPosition[] {
    return this.getCreepOffsets().map((offset) => {
      const x = _.max([_.min([this.position.x + offset.x, 49]), 0]);
      const y = _.max([_.min([this.position.y + offset.y, 49]), 0]);
      const roomName = this.position.roomName;
      return new RoomPosition(x, y, roomName);
    });
  }

  setDirection(direction: DirectionConstant) {
    this.direction = direction;
  }

  setMinEnergy(minEnergy: number) {
    this.minEnergy = minEnergy;
  }

  setPosition(position: RoomPosition) {
    this.position = position;

    if (this.position !== this.previousPositions[0]) {
      this.previousPositions.unshift(this.position);
      this.previousPositions.splice(MAX_PREVIOUS_POSITIONS);
    }
  }

  getPreviousPositions(): RoomPosition[] {
    return this.previousPositions;
  }

  setTarget(targets: WarPartyTarget[], trace: Tracer): WarPartyTarget {
    const target = _.find(targets, (target) => {
      return this.position.getRangeTo(target) <= 3;
    });

    if (target) {
      Game.map.visual.line(this.position, target.pos, {color: '#FF0000'});
    } else {
      trace.info('no targets in range');
      return null;
    }

    trace.info('setting targets', {target});

    const creeps = this.getAssignedCreeps();
    creeps.forEach((creep) => {
      creep.memory[MEMORY.MEMORY_ATTACK] = target?.id;
    });

    return target;
  }

  setHeal(_trace: Tracer) {
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

    const quad = _.sortBy(creeps, 'ttl').slice(0, 4);
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

  requestCreeps(trace: Tracer, kernel: Kernel, base: Base) {
    const baseRoomName = base.primary;
    const baseRoom = Game.rooms[baseRoomName];
    if (!baseRoom) {
      trace.info('base room not visible', {baseRoomName});
      return;
    }

    const spawns = baseRoom.find(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_SPAWN,
    });
    if (!spawns || !spawns.length) {
      trace.info('no spawns found');
      return;
    }

    const path = PathFinder.search(this.position, spawns[0].pos, {
      maxOps: 4000,
    });

    // TODO need to calculate plains cost
    const plainsCost = 2;
    // path length * move cost/ticks
    const travelTime = path.path.length * plainsCost;
    // 150 for the 50 parts
    const buildTime = 150;
    this.deployTicks = travelTime + buildTime;
    if (path.incomplete) {
      this.deployTicks += 200;
    }

    trace.info('deploy time', {
      pathLength: path.path.length,
      pathIncomplete: path.incomplete,
      plainsCost,
    });

    const creeps = this.getAssignedCreeps();
    const freshCreeps = creeps.filter((creep) => {
      return creep.spawning || (creep.ticksToLive > this.deployTicks);
    });

    if (freshCreeps.length >= MAX_PARTY_SIZE) {
      trace.info('we have enough creeps', {
        freshCreeps: freshCreeps.map((creep) => creep.name),
        deployTicks: this.deployTicks,
        lowestTTL: _.min(
          creeps.filter((creep) => creep.ticksToLive)
            .map((creep) => creep.ticksToLive),
        ),
      });
      return;
    }

    const idx = _.max([creeps.length - 1, 0]) % 4;
    const position = this.getCreepPosition(idx, trace);

    const priority = this.priority;
    const ttl = this.requestCreepTTL;
    const role = this.role;
    const memory = {
      [MEMORY.MEMORY_PARTY_ID]: this.id,
      // Tell creep to move to it's rally point position
      [MEMORY.MEMORY_POSITION_X]: position.x,
      [MEMORY.MEMORY_POSITION_Y]: position.y,
      [MEMORY.MEMORY_POSITION_ROOM]: position.roomName,
      [MEMORY.MEMORY_ASSIGN_ROOM]: position.roomName,
      [MEMORY.MEMORY_BASE]: base.id,
    };

    const request = createSpawnRequest(priority, ttl, role, memory, this.parts, 0);

    trace.notice('requesting creep', {
      deployTicks: this.deployTicks,
      request,
    });

    kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
  }
}
