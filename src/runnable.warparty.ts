import * as _ from 'lodash';
import {Kingdom} from "./org.kingdom";
import {Colony} from './org.colony';
import {RunnableResult, running, sleeping, terminate, STATUS_TERMINATED} from "./os.process";
import {Tracer} from './lib.tracing';
import {WORKER_ATTACKER} from './constants.creeps'
import {PRIORITY_ATTACKER} from "./constants.priorities";
import PartyRunnable from './runnable.party';
import {Direction} from 'node:readline';
import {Dir} from 'node:fs';

const REQUEST_ATTACKER_TTL = 30;

export enum Phase {
  PHASE_MARSHAL = 'marshal',
  PHASE_EN_ROUTE = 'en_route',
  PHASE_ATTACK = 'attack',
}

const DIRECTION_2BY2_FORMATION = {
  [TOP]: [
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
  ],
  [TOP_RIGHT]: [
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
  ],
  [RIGHT]: [
    {x: 1, y: 0}, // BR
    {x: 1, y: -1}, // TR
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
    {x: 1, y: 0}, // BR
    {x: 0, y: 0}, // BL
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
    {x: 0, y: 0}, // BL
    {x: 0, y: -1}, // TL
    {x: 1, y: 0}, // BR
    {x: 1, y: -1}, // TR
  ],
  [TOP_LEFT]: [
    {x: 0, y: -1}, // TL
    {x: 1, y: -1}, // TR
    {x: 0, y: 0}, // BL
    {x: 1, y: 0}, // BR
  ],
}

const CORNERS: Record<DirectionConstant, {x: number, y: number}> = {
  [TOP]: null,
  [RIGHT]: null,
  [BOTTOM]: null,
  [LEFT]: null,
  [TOP_LEFT]: {x: -1, y: -2}, // TL
  [TOP_RIGHT]: {x: 2, y: -2}, // TR
  [BOTTOM_LEFT]: {x: -1, y: 1}, // BL
  [BOTTOM_RIGHT]: {x: 2, y: 1}, // BR
}

const ADJACENT_SIDES: Record<DirectionConstant, DirectionConstant[]> = {
  [TOP]: [],
  [RIGHT]: [],
  [BOTTOM]: [],
  [LEFT]: [],
  [TOP_RIGHT]: [TOP, RIGHT],
  [BOTTOM_RIGHT]: [BOTTOM, RIGHT],
  [BOTTOM_LEFT]: [BOTTOM, LEFT],
  [TOP_LEFT]: [TOP, LEFT],
}

export default class WarPartyRunnable {
  id: string;
  flagId: string; // Starting position
  targetRoom: string; // Destination room
  phase: Phase;
  position: RoomPosition;
  destination: RoomPosition;
  // TODO move to Scribe
  costMatrices: Record<string, CostMatrix>;

  party: PartyRunnable;

  path: RoomPosition[];
  pathDestination: RoomPosition;
  pathComplete: boolean;
  pathTime: number;

  kingdom: Kingdom;

  constructor(id: string, colony: Colony, flagId: string, position: RoomPosition, targetRoom: string,
    phase: Phase) {
    this.id = id;
    this.flagId = flagId;
    this.targetRoom = targetRoom;
    this.phase = phase || Phase.PHASE_MARSHAL;
    this.costMatrices = {};
    this.position = position;
    this.destination = new RoomPosition(25, 25, targetRoom);

    this.party = new PartyRunnable(id, colony, position, WORKER_ATTACKER, PRIORITY_ATTACKER,
      REQUEST_ATTACKER_TTL);

    this.kingdom = null;

    this.pathDestination = null;
    this.path = [];
    this.pathTime = 0;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    this.kingdom = kingdom

    const targetRoom = kingdom.getWarManager().getTargetRoom();
    const flag = this.getFlag();
    const creeps = this.getAssignedCreeps();
    const targetRoomObject = Game.rooms[targetRoom];
    const positionRoomObject = Game.rooms[this.position.roomName];

    if (!targetRoom || !flag) {
      trace.log("no rally point defined, terminating war party");
      this.party.done();
    } else {
      trace.log('war party run', {
        id: this.id,
        flag: flag.name,
        colonyId: this.getColony().id,
        primaryRoomId: this.getColony().primaryRoomId,
        targetRoom,
        phase: this.phase,
        position: this.position,
        creeps: creeps.length,
        costMatrices: Object.keys(this.costMatrices),
      });

      this.setHeal(trace);

      if (this.phase === Phase.PHASE_MARSHAL) {
        // If we have at least 4 creeps and they are in position, begin deployment
        if (this.inPosition(this.position, trace) && creeps.length >= 4) {
          this.phase = Phase.PHASE_EN_ROUTE;
          trace.log('moving to deploy phase', {phase: this.phase});
        } else {
          this.destination = new RoomPosition(25, 25, this.targetRoom);
          this.position = flag.pos;
          this.marshal(this.position, creeps, trace);
        }
      }

      if (this.phase === Phase.PHASE_EN_ROUTE) {
        // If we are out of creep, remarshal
        if (!creeps.length) {
          this.phase = Phase.PHASE_MARSHAL;
          trace.log('moving to marshal phase', {phase: this.phase});
        } else if (targetRoom === this.position.roomName) {
          this.phase = Phase.PHASE_ATTACK;
          trace.log('moving to attack phase', {phase: this.phase});
        } else {
          this.destination = new RoomPosition(25, 25, this.targetRoom);
          this.deploy(kingdom, positionRoomObject, targetRoom, creeps, trace);
        }
      }

      if (this.phase === Phase.PHASE_ATTACK) {
        if (!creeps.length) {
          this.phase = Phase.PHASE_MARSHAL;
          trace.log('moving to marshal phase', {phase: this.phase});
        } else {
          const done = this.engage(kingdom, targetRoomObject, creeps, trace);
          if (done) {
            this.party.done();
          }
        }
      }
    }

    // Tick the party along
    const partyResult = this.party.run(kingdom, trace);
    if (partyResult.status === STATUS_TERMINATED) {
      trace.log('party terminated');
      return partyResult;
    }

    if (global.LOG_WHEN_ID === this.id) {
      this.visualizePathToTarget(this.position, this.destination, trace);
    }

    return running();
  }

  marshal(position: RoomPosition, creeps: Creep[], trace: Tracer) {
    if (!creeps.length) {
      return;
    }

    this.position = this.getFlag().pos;
    this.setPosition(position, trace);
  }

  deploy(kingdom: Kingdom, room: Room, targetRoom: string, creeps: Creep[], trace: Tracer) {
    trace.log("deploy", {
      targetRoom,
      position: this.position,
      destination: this.destination,
    });

    const [nextPosition, direction, blockers] = this.getNextPosition(this.position, this.destination, trace);

    trace.log("next position", {targetRoom, nextPosition, blockers: blockers.map(blocker => blocker.id)});

    if (nextPosition) {
      this.setPosition(nextPosition, trace);
    } else {
      trace.log("no next position");
    }

    if (direction) {
      trace.log("changing formation", {direction});
      this.setFormation(direction);
    }

    let targets: (Creep | Structure)[] = [];

    const friends = kingdom.config.friends;

    if (room) {
      // determine target (hostile creeps, towers, spawns, nukes, all other structures)
      targets = targets.concat(room.find(FIND_HOSTILE_CREEPS, {
        filter: creep => friends.indexOf(creep.owner.username) === -1
      }));
    }

    if (blockers.length) {
      trace.log("blockers", {blocked: blockers.map(structure => structure.id)});
      targets = targets.concat(blockers);
    }

    if (targets.length) {
      targets = _.sortBy(targets, (target) => {
        return creeps[0].pos.getRangeTo(target);
      });

      trace.log("targets", {targetsLength: targets.length})
      const target = this.party.setTarget(targets, trace);
      if (target) {
        this.alignWithTarget(target, nextPosition, trace);
      }
    } else {
      trace.log("no targets");
    }
  }

  engage(kingdom: Kingdom, room: Room, creeps: Creep[], trace: Tracer): boolean {
    let destination = new RoomPosition(25, 25, this.targetRoom);
    if (room && room.controller) {
      destination = room.controller.pos;
    }

    let targets = [];

    // If we have visibility into the room, get targets and choose first as destination
    if (room) {
      targets = this.getTargets(kingdom, room);
      if (targets.length) {
        destination = targets[0].pos;
      }
    }

    if (!targets.length) {
      return true;
    }

    this.destination = destination;

    const [nextPosition, direction, blockers] = this.getNextPosition(this.position, this.destination, trace);
    trace.log("next position", {nextPosition, blockers: blockers.map(blocker => blocker.id)});
    if (nextPosition) {
      this.setPosition(nextPosition, trace);
    } else {
      trace.log("no next position");
    }

    if (direction) {
      trace.log("changing formation", {direction});
      this.setFormation(direction);
    }

    let nearbyTargets: (Creep | Structure)[] = [];

    if (room) {
      const friends = kingdom.config.friends;
      // determine target (hostile creeps, towers, spawns, nukes, all other structures)
      nearbyTargets = nearbyTargets.concat(room.find(FIND_HOSTILE_CREEPS, {
        filter: creep => friends.indexOf(creep.owner.username) === -1
      }));
    }

    if (blockers.length) {
      trace.log("blockers", {blocked: blockers.map(structure => structure.id)});
      nearbyTargets = nearbyTargets.concat(blockers);
    }

    // Add other targets
    if (targets.length) {
      nearbyTargets = nearbyTargets.concat(targets);
    }

    if (nearbyTargets.length) {
      trace.log("nearby targets", {nearByTargetsLength: nearbyTargets.length})
      const target = this.party.setTarget(nearbyTargets, trace);
      if (target) {
        this.alignWithTarget(target, nextPosition, trace);
      }
    } else {
      trace.log("no targets");
    }

    return false;
  }

  alignWithTarget(target: (Creep | Structure), position: RoomPosition, trace: Tracer) {
    let inCorner: DirectionConstant = null;
    _.each<Record<DirectionConstant, {x: number, y: number}>>(CORNERS, (corner, direction) => {
      if (!corner) {
        return;
      }

      trace.log("corner", {corner, direction});

      const x = _.min([_.max([this.position.x + corner.x, 0]), 49]);
      const y = _.min([_.max([this.position.y + corner.y, 0]), 49]);
      const cornerPosition = new RoomPosition(x, y, this.position.roomName);

      trace.log("cornerPosition", {cornerPosition});
      if (target.pos.isEqualTo(cornerPosition)) {
        inCorner = parseInt(direction, 10) as DirectionConstant;
      }
    });

    if (inCorner) {
      const sides = ADJACENT_SIDES[inCorner];
      if (sides.length) {
        const side = _.find(sides, (side) => {
          const shiftedPosition = this.party.shiftPosition(position, side);
          return !this.isBlocked(shiftedPosition, trace);
        });

        if (side) {
          const shiftPosition = this.party.shiftPosition(position, side);
          if (shiftPosition) {
            trace.notice("shifting position", {shiftPosition});
            this.setPosition(shiftPosition, trace);
          }
        }
      }
    }
  }

  getTargets(kingdom: Kingdom, room: Room): (Creep | Structure)[] {
    const friends = kingdom.config.friends;

    let targets: (Structure | Creep)[] = [];
    // determine target (hostile creeps, towers, spawns, nukes, all other structures)
    targets = targets.concat(room.find(FIND_HOSTILE_CREEPS, {
      filter: creep => friends.indexOf(creep.owner.username) === -1
    }));

    targets = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_TOWER &&
        friends.indexOf(structure.owner.username) === -1,
    });

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_SPAWN &&
        friends.indexOf(structure.owner.username) === -1,
    }));

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_NUKER &&
        friends.indexOf(structure.owner.username) === -1,
    }));

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType === STRUCTURE_CONTROLLER) {
          return false;
        }

        return friends.indexOf(structure.owner.username) === -1;
      }
    }));

    targets = targets.concat(room.find<Structure>(FIND_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType === STRUCTURE_CONTROLLER) {
          return false;
        }

        if (structure instanceof OwnedStructure && structure.owner) {
          const structureOwner = structure.owner.username;
          if (structureOwner && kingdom.config.friends.indexOf(structureOwner) !== -1) {
            return false;
          }

          return true;
        }

        const roomOwner = structure.room.controller?.owner?.username;
        if (roomOwner && kingdom.config.friends.indexOf(roomOwner) !== -1) {
          return false;
        }

        return true;
      }
    }));

    return targets;
  }

  getFlag() {
    return Game.flags[this.flagId] || null;
  }

  getAssignedCreeps() {
    return this.party.getAssignedCreeps();
  }

  isCreepLowHealth(creeps: Creep[]): boolean {
    let lowHealth = false;

    creeps.forEach((creep) => {
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

  visualizePathToTarget(origin: RoomPosition, destination: RoomPosition, trace) {
    const path = this.getPath(origin, destination, trace);
    if (!path) {
      trace.log('no path to visualize');
      return;
    }

    const visual = new RoomVisual()
    visual.poly(path);
  }

  getPath(origin: RoomPosition, destination: RoomPosition, trace: Tracer) {
    if (this.path && this.pathDestination && this.pathDestination.isEqualTo(destination) &&
      Game.time - this.pathTime < 50) {
      trace.log('path cache hit', {pathLength: this.path.length, origin, destination})
      return this.path;
    }

    trace.log('war party path cache miss', {origin, destination});

    this.pathDestination = destination;
    this.pathComplete = false;
    this.pathTime = Game.time;

    const result = PathFinder.search(origin, destination, {
      roomCallback: this.getRoomCostMatrix.bind(this),
      maxOps: 4000,
    });

    trace.log('search', {
      origin: origin,
      destination: destination,
      result,
    });

    this.path = result.path;
    this.pathComplete = !result.incomplete;

    return this.path;
  }

  getNextPosition(currentPosition: RoomPosition, destination: RoomPosition,
    trace: Tracer): [RoomPosition, (DirectionConstant | 0), Structure[]] {

    // Figure out where we are going
    const path = this.getPath(currentPosition, destination, trace);
    if (!path) {
      // Cant find where we are going, freeze
      // TODO maybe suicide
      return [currentPosition, 0, []];
    }

    // We know where we are going and the path
    trace.log("path found", {pathLength: path.length, currentPosition, destination});

    // Work out the closest position along the path and it's distance
    // Scan path and find closest position, use that as as position on path
    const currentIndex = _.findIndex(path, (position) => {
      return position.isEqualTo(currentPosition);
    });

    // Log a message if we could not find an index, should not happen much
    if (currentIndex < 0) {
      trace.log('could not find origin/creep index', {currentIndex, currentPosition, path})
    }

    // Assume we are off path
    let nextIndex = currentIndex;

    // Advance the position by one if creeps are ready, on an edge, start of path
    if (this.inPosition(this.position, trace) || this.onEdge() || currentIndex === -1) {
      nextIndex++;
    }

    // Get the next position (may be same as current, if creeps are not in position)
    let nextPosition = path[nextIndex];
    if (!nextPosition) {
      trace.log('no next position', {nextIndex, path});
      return [currentPosition, 0, []];
    }

    let direction: (DirectionConstant | 0) = 0;

    // Determine if we plan to move
    const positionChanged = !currentPosition.isEqualTo(nextPosition);
    if (positionChanged) {
      direction = currentPosition.getDirectionTo(nextPosition);
    }

    // Check if our path is blocked
    let blockers: Structure[] = [];
    if (direction && currentPosition.roomName === nextPosition.roomName) {
      blockers = this.getBlockingStructures(direction, nextPosition, trace);
      trace.log("blocked", {blockers});
    }

    // We are blocked, don't move and instead clear blockage
    if (blockers.length) {
      nextPosition = currentPosition;
    }

    trace.log('get next position', {
      positionChanged,
      currentIndex,
      currentPosition,
      direction,
      blockers: blockers.map(blocker => blocker.id),
      nextIndex,
      nextPosition,
      pathLength: path.length,
      destination,
    });

    return [nextPosition, direction, blockers];
  }

  getRoomCostMatrix(roomName: string): CostMatrix | boolean {
    if (this.costMatrices[roomName]) {
      return this.costMatrices[roomName];
    }

    const costMatrix = new PathFinder.CostMatrix();

    const room = Game.rooms[roomName];
    if (!room) {
      return costMatrix;
    }

    const owner = room.controller?.owner?.username;
    if (owner) {
      if (this.kingdom.config.friends.indexOf(owner) !== -1) {
        return false;
      }
      if (this.kingdom.config.neutral.indexOf(owner) !== -1) {
        return false;
      }
    }

    const terrain = Game.map.getRoomTerrain(roomName);

    for (let x = 0; x <= 49; x++) {
      for (let y = 0; y <= 49; y++) {
        const mask = terrain.get(x, y);
        if (mask) {
          const maskValue = (mask === TERRAIN_MASK_WALL) ? 255 : 5;

          if (costMatrix.get(x, y) < maskValue) {
            costMatrix.set(x, y, maskValue);
          }

          if (x !== 0 && costMatrix.get(x - 1, y) < maskValue) {
            costMatrix.set(x - 1, y, maskValue);
          }

          if (y < 49 && costMatrix.get(x, y + 1) < maskValue) {
            costMatrix.set(x, y + 1, maskValue);
          }

          if (x !== 0 && y < 49 && costMatrix.get(x - 1, y + 1) < maskValue) {
            costMatrix.set(x - 1, y + 1, maskValue);
          }

          continue;
        }

        if (x <= 1 || y <= 1 || x >= 48 || y >= 48) {
          if (costMatrix.get(x, y) < 25) {
            costMatrix.set(x, y, 25);
          }
        }
      }
    }

    /*
    const structures = room.find<Structure>(FIND_STRUCTURES, {
      filter: structure => structure.structureType
    });
    structures.forEach((structure) => {
      if (structure.structureType === STRUCTURE_ROAD) {
        return;
      }

      let wallValue = 255;
      costMatrix.set(structure.pos.x, structure.pos.y, wallValue);
      costMatrix.set(structure.pos.x - 1, structure.pos.y, wallValue);
      costMatrix.set(structure.pos.x - 1, structure.pos.y + 1, wallValue);
      costMatrix.set(structure.pos.x, structure.pos.y + 1, wallValue);
    });

    const walls = room.find<StructureWall>(FIND_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_WALL
    });
    walls.forEach((wall) => {
      let wallValue = 255;
      if (room.controller?.owner?.username !== 'ENETDOWN') {
        wallValue == 25 + (wall.hits / 300000000 * 100);
      }

      costMatrix.set(wall.pos.x, wall.pos.y, wallValue);
      costMatrix.set(wall.pos.x - 1, wall.pos.y, wallValue);
      costMatrix.set(wall.pos.x - 1, wall.pos.y + 1, wallValue);
      costMatrix.set(wall.pos.x, wall.pos.y + 1, wallValue);
    });
    */

    this.costMatrices[roomName] = costMatrix;

    return costMatrix;
  }

  printCostMatric(roomName: string) {
    const matrix = this.costMatrices[roomName];
    if (!matrix) {
      return;
    }

    const visual = new RoomVisual(roomName);

    for (let x = 0; x <= 49; x++) {
      for (let y = 0; y <= 49; y++) {
        const cost = matrix.get(x, y);
        visual.text((cost / 5).toString(), x, y);
      }
    }
  }

  setFormation(direction: DirectionConstant) {
    this.party.setFormation(DIRECTION_2BY2_FORMATION[direction]);
  }

  getPosition() {
    return this.party.getPosition();
  }

  inPosition(position: RoomPosition, trace: Tracer) {
    return this.party.inPosition(position, trace);
  }

  isBlocked(position: RoomPosition, trace: Tracer): boolean {
    return this.party.isBlocked(position, trace);
  }

  getBlockingStructures(direction: DirectionConstant, position: RoomPosition, trace: Tracer): Structure[] {
    return this.party.getBlockingStructures(direction, position, trace);
  }

  onEdge() {
    return this.position.x === 1 || this.position.x >= 48 || this.position.y <= 1 ||
      this.position.y === 49;
  }

  setPosition(position: RoomPosition, trace: Tracer) {
    this.position = position;
    this.party.setPosition(position);
  }

  setTarget(targetRequests: Creep[], trace: Tracer): (Creep | Structure) {
    return this.party.setTarget(targetRequests, trace);
  }

  setHeal(trace: Tracer) {
    this.party.setHeal(trace);
  }
}
