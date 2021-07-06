import * as _ from 'lodash';
import {Kingdom} from "./org.kingdom";
import Colony from './org.colony';
import {RunnableResult, running, sleeping, terminate, STATUS_TERMINATED} from "./os.process";
import {Tracer} from './lib.tracing';
import {WORKER_ATTACKER} from './constants.creeps'
import {PRIORITY_ATTACKER} from "./constants.priorities";
import PartyRunnable from './runnable.party';

const REQUEST_ATTACKER_TTL = 30;
const PHASE_FORMING = 'forming';
const PHASE_EN_ROUTE = 'en_route';
const PHASE_ATTACK = 'attack';

const ADJACENT_DIRECTION = {
  [TOP]: {x: 0, y: 0},
  [TOP_RIGHT]: {x: 0, y: 0},
  [RIGHT]: {x: 0, y: 0},
  [BOTTOM_RIGHT]: {x: 0, y: 0},
  [BOTTOM]: {x: 0, y: 0},
  [BOTTOM_LEFT]: {x: 0, y: 0},
  [LEFT]: {x: 0, y: 0},
  [TOP_LEFT]: {x: 0, y: 0},
}

export default class WarPartyRunnable {
  id: string;
  flagId: string;
  targetRoom: string;
  phase: string;
  party: PartyRunnable;

  pathDestination: RoomPosition;
  path: RoomPosition[];
  pathIndex: number;
  costMatrices: Record<string, CostMatrix>;
  stuckCounter: number;

  constructor(id: string, colony: Colony, flagId: string, position: RoomPosition, targetRoom: string,
    phase: string) {
    this.id = id;
    this.flagId = flagId;
    this.targetRoom = targetRoom;
    this.phase = phase || PHASE_FORMING;
    this.party = new PartyRunnable(id, colony, position, WORKER_ATTACKER, PRIORITY_ATTACKER,
      REQUEST_ATTACKER_TTL);
    this.pathDestination = null;
    this.path = [];
    this.pathIndex = -1;
    this.costMatrices = {};
    this.stuckCounter = 0;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    const targetRoom = kingdom.getWarManager().getTargetRoom();
    const flag = this.getFlag();
    const creeps = this.getAssignedCreeps();

    if (!targetRoom || !flag) {
      trace.log("no rally point defined, terminating war party");
      this.party.done();
    } else {
      // Check if we need to change rooms
      if (this.targetRoom != targetRoom) {
        trace.log('target room changed', {prev: this.targetRoom, current: targetRoom});
        this.phase = PHASE_EN_ROUTE;
        this.targetRoom = targetRoom;
      }

      trace.log('war party run', {
        id: this.id,
        flag: flag.name,
        targetRoom,
        phase: this.phase,
        creeps: creeps.length,
        costMatrices: Object.keys(this.costMatrices),
      });

      this.setHeal(trace);

      if (this.phase === PHASE_FORMING) {
        this.marshal(flag, creeps, trace)
      } else if (this.phase === PHASE_EN_ROUTE) {
        this.deploy(targetRoom, creeps, trace);
      } else if (this.phase === PHASE_ATTACK) {
        if (!Game.rooms[targetRoom] || !creeps.length || creeps[0].pos.roomName !== targetRoom) {
          this.phase = (creeps.length < 4) ? PHASE_FORMING : PHASE_EN_ROUTE;
        } else {
          this.engage(targetRoom, creeps, trace);
        }
      } else {
        trace.log('invalid war party phase', {phase: this.phase});
        this.party.done();
      }
    }

    // Tick the party along
    const partyResult = this.party.run(kingdom, trace);
    if (partyResult.status === STATUS_TERMINATED) {
      trace.log('party terminated');
      return partyResult;
    }

    return running();
  }

  marshal(flag: Flag, creeps: Creep[], trace: Tracer) {
    if (!creeps.length) {
      return;
    }

    this.setPosition(flag.pos, trace);

    if (this.inPosition(trace) && creeps.length === 4) {
      this.phase = PHASE_EN_ROUTE;
      trace.log('moving to next phase', {phase: this.phase});
    }
  }

  deploy(targetRoom: string, creeps: Creep[], trace: Tracer) {
    if (!creeps.length) {
      return;
    }

    // TODO bug: need to check if we have at least one creep
    if (targetRoom === creeps[0].pos.roomName) {
      this.phase = PHASE_ATTACK;
      trace.log('moving to next phase', {phase: this.phase});
      return;
    }

    const destination = new RoomPosition(25, 25, targetRoom);
    const nextPosition = this.getNextPosition(destination, creeps[0], false, trace);
    trace.log("next position", {targetRoom, nextPosition});
    if (nextPosition) {
      this.setPosition(this.path[this.pathIndex], trace);
    }
  }

  engage(targetRoom: string, creeps: Creep[], trace: Tracer) {
    const room = Game.rooms[targetRoom];
    let destination = new RoomPosition(25, 25, targetRoom);

    let blocked: Structure[] = [];
    let target: (Creep | Structure) = null;
    let targets: (Creep | Structure)[] = [];
    if (room) {
      // determine target (hostile creeps, towers, spawns, nukes, all other structures)
      targets = targets.concat(room.find(FIND_HOSTILE_CREEPS));

      targets = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_TOWER,
      });

      targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_SPAWN,
      }));

      targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_NUKER,
      }));

      blocked = this.getBlockingStructures(creeps[0].pos);
      trace.log("blocked", {blocked});
      targets = targets.concat(blocked);

      targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES));

      // TODO, update attackers to have ranged attack
      // melee attacks should mass heal
      // ranged attacks should heal

      if (targets.length) {
        destination = targets[0].pos;
        this.party.setTarget(targets, trace);
      }
    }

    const nextPosition = this.getNextPosition(destination, creeps[0], blocked.length > 0, trace);
    trace.log("next position", {targetRoom, nextPosition});
    if (nextPosition) {
      this.setPosition(nextPosition, trace);
    }
  }

  getFlag() {
    return Game.flags[this.flagId] || null;
  }

  getAssignedCreeps() {
    return this.party.getAssignedCreeps();
  }

  isCreepLowHealth(): boolean {
    let lowHealth = false;

    this.getAssignedCreeps().forEach((creep) => {
      if (creep.hits === 0) {
        return lowHealth = true;
      }

      if (creep.hitsMax / creep.hits < 0.8) {
        return lowHealth = true;
      }
    });

    return lowHealth;
  }

  getColony(): Colony {
    return this.party.getColony();
  }

  getNextPosition(position: RoomPosition, leader: Creep, blocked: boolean, trace: Tracer): RoomPosition {
    if (!this.path || !this.pathDestination || !this.pathDestination.isEqualTo(position) ||
      this.pathIndex > this.path.length) {
      this.pathIndex = -1;
      this.pathDestination = position;

      const result = PathFinder.search(leader.pos, position, {
        roomCallback: this.getRoomCostMatrix.bind(this),
      });

      trace.log('search', {
        leaderPos: leader.pos,
        destination: position,
        result,
      });

      this.path = result.path;
    }

    if (!this.path.length) {
      return null;
    }

    // Check if we have hit the end of the path
    if (leader.pos.isEqualTo(this.path[this.path.length - 1])) {
      trace.log('end of path', {leaderPos: leader.pos, end: this.path[this.path.length - 1]});
      return null;
    }

    const visual = new RoomVisual(leader.pos.roomName);
    visual.poly(this.path.filter(pos => pos.roomName === leader.pos.roomName));

    if (!blocked && (this.inPosition(trace) || this.onEdge() || this.stuckCounter >= 10)) {
      // Move away from target if we have creeps that are low health
      if (this.isCreepLowHealth()) {
        this.pathIndex--;
      } else {
        this.pathIndex++;
      }

      this.stuckCounter = 0;
    } else if (!blocked) {
      this.stuckCounter++
    }

    const nextPosition = this.path[this.pathIndex];

    trace.log('get next position', {
      pathIndex: this.pathIndex,
      stuckCounteR: this.stuckCounter,
      nextPosition,
      pathLength: this.path.length,
      pathDestination: this.pathDestination,
    })

    return nextPosition;
  }

  getRoomCostMatrix(roomName: string): CostMatrix {
    if (this.costMatrices[roomName]) {
      return this.costMatrices[roomName];
    }

    const costMatrix = new PathFinder.CostMatrix();
    const terrain = Game.map.getRoomTerrain(roomName);
    const visual = new RoomVisual(roomName);

    for (let x = 0; x <= 49; x++) {
      for (let y = 0; y <= 49; y++) {
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
          costMatrix.set(x - 1, y, 255);
          visual.text("255", x - 1, y);
          costMatrix.set(x - 1, y + 1, 255);
          visual.text("255", x - 1, y + 1);
          costMatrix.set(x, y + 1, 255);
          visual.text("255", x, y + 1);
          continue;
        }

        if (x <= 1 || y <= 1 || x >= 48 || y >= 48) {
          costMatrix.set(x, y, 25);
          visual.text("25", x, y);
        }
      }
    }

    const room = Game.rooms[roomName];
    if (room) {
      const wallValue = room.controller?.owner?.username === 'ENETDOWN' ? 255 : 10;
      const walls = room.find(FIND_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_WALL
      });
      walls.forEach((wall) => {
        costMatrix.set(wall.pos.x, wall.pos.y, wallValue);
        visual.text(wallValue.toString(), wall.pos.x, wall.pos.y);
        costMatrix.set(wall.pos.x - 1, wall.pos.y, wallValue);
        visual.text(wallValue.toString(), wall.pos.x - 1, wall.pos.y);
        costMatrix.set(wall.pos.x - 1, wall.pos.y + 1, wallValue);
        visual.text(wallValue.toString(), wall.pos.x - 1, wall.pos.y + 1);
        costMatrix.set(wall.pos.x, wall.pos.y + 1, wallValue);
        visual.text(wallValue.toString(), wall.pos.x, wall.pos.y + 1);
      });
    }

    this.costMatrices[roomName] = costMatrix;

    return costMatrix;
  }

  getPosition() {
    return this.party.getPosition();
  }

  inPosition(trace: Tracer) {
    return this.party.inPosition(trace);
  }

  onEdge() {
    return this.party.onEdge();
  }

  getBlockingStructures(leaderPos: RoomPosition): Structure[] {
    if (!this.path.length) {
      return [];
    }

    const next = this.path[this.pathIndex + 1];
    if (!next) {
      return [];
    }

    const direction = leaderPos.getDirectionTo(next);

    const adjX = next.x + ADJACENT_DIRECTION[direction].x;
    const adjY = next.y + ADJACENT_DIRECTION[direction].y;
    const adjacent = new RoomPosition(adjX, adjY, next.roomName);

    let structures = [];
    if (next.roomName === leaderPos.roomName) {
      structures = structures.concat(next.lookFor(LOOK_STRUCTURES));
    }
    if (adjacent.roomName === leaderPos.roomName) {
      structures = structures.concat(adjacent.lookFor(LOOK_STRUCTURES));
    }

    structures = structures.filter((structure) => {
      return structure.structureType !== STRUCTURE_ROAD;
    });

    return structures;
  }

  setPosition(position: RoomPosition, trace: Tracer) {
    this.party.setPosition(position);
  }

  setTarget(targetRequests: Creep[], trace: Tracer) {
    this.party.setTarget(targetRequests, trace);
  }

  setHeal(trace: Tracer) {
    this.party.setHeal(trace);
  }
}
