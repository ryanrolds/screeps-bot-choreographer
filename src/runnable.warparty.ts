import * as _ from 'lodash';
import {Base, getBasePrimaryRoom} from './base';
import {BaseRoomThreadFunc, threadBaseRoom} from './base_room';
import {AttackRequest, AttackStatus, ATTACK_ROOM_TTL, Phase} from './constants.attack';
import {DEFINITIONS} from './constants.creeps';
import {PRIORITY_ATTACKER} from './constants.priorities';
import * as TOPICS from './constants.topics';
import {Kernel} from './kernel';
import {buildAttacker, newMultipliers} from './lib.attacker_builder';
import {AllowedCostMatrixTypes} from './lib.costmatrix_cache';
import {FindPathPolicy, getPath, visualizePath} from './lib.pathing';
import {scoreRoomDamage, scoreStorageHealing} from './lib.scoring';
import {Tracer} from './lib.tracing';
import {running, STATUS_TERMINATED} from './os.process';
import {RunnableResult} from './os.runnable';
import PartyRunnable, {FORMATION_QUAD, FORMATION_SINGLE_FILE, FORMATION_TYPE} from './runnable.party';
import {RoomEntry} from './runnable.scribe';

const REQUEST_ATTACKER_TTL = 30;
const UPDATE_PARTS_INTERVAL = 50;

export type WarPartyTarget = (Creep | Structure);

const CORNERS: Map<DirectionConstant, {x: number, y: number}> = new Map([
  [TOP, null],
  [RIGHT, null],
  [BOTTOM, null],
  [LEFT, null],
  [TOP_LEFT, {x: -1, y: -2}], // TL
  [TOP_RIGHT, {x: 2, y: -2}], // TR
  [BOTTOM_LEFT, {x: -1, y: 1}], // BL
  [BOTTOM_RIGHT, {x: 2, y: 1}], // BR
]);

const ADJACENT_SIDES: Map<DirectionConstant, DirectionConstant[]> = new Map([
  [TOP, []],
  [RIGHT, []],
  [BOTTOM, []],
  [LEFT, []],
  [TOP_RIGHT, [TOP, RIGHT]],
  [BOTTOM_RIGHT, [BOTTOM, RIGHT]],
  [BOTTOM_LEFT, [BOTTOM, LEFT]],
  [TOP_LEFT, [TOP, LEFT]],
]);


export const warPartyQuadPolicy: FindPathPolicy = {
  room: {
    avoidFriendlyRooms: true,
    avoidHostileRooms: false,
    avoidRoomsWithKeepers: false,
    avoidRoomsWithTowers: true,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.PARTY,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: false,
    maxSearchRooms: 16,
    maxOps: 6000,
    maxPathRooms: 5,
    ignoreCreeps: false,
  },
};

export const warPartySingleFilePolicy: FindPathPolicy = {
  room: {
    avoidFriendlyRooms: true,
    avoidHostileRooms: false,
    avoidRoomsWithKeepers: false,
    avoidRoomsWithTowers: true,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.COMMON,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: false,
    maxSearchRooms: 16,
    maxOps: 6000,
    maxPathRooms: 5,
    ignoreCreeps: false,
  },
};

export default class WarPartyRunnable {
  id: string;
  baseId: string;
  flagId: string; // Starting position
  targetRoom: string; // Destination room
  role: string;
  parts: BodyPartConstant[];
  roomDamage: number;
  minEnergy: number;
  phase: Phase;

  destination: RoomPosition;
  range: number;
  position: RoomPosition;
  direction: DirectionConstant;

  party: PartyRunnable;

  path: RoomPosition[];
  pathDestination: RoomPosition;
  pathComplete: boolean;
  pathTime: number;
  cannotFindPath: boolean;

  kernel: Kernel;
  threadUpdateParts: BaseRoomThreadFunc;

  constructor(id: string, baseId: string, flagId: string, position: RoomPosition, targetRoom: string,
    role: string, phase: Phase) {
    this.id = id;
    this.baseId = baseId;
    this.flagId = flagId;
    this.targetRoom = targetRoom;
    this.role = role;
    this.parts = null;
    this.roomDamage = null;
    this.minEnergy = DEFINITIONS.get(this.role)?.energyMinimum || 0;
    this.phase = phase || Phase.PHASE_MARSHAL;
    this.position = position;
    this.destination = new RoomPosition(25, 25, targetRoom);
    this.range = 3;
    this.direction = BOTTOM;

    this.party = new PartyRunnable(id, baseId, position, role, [], this.minEnergy, PRIORITY_ATTACKER,
      REQUEST_ATTACKER_TTL);

    this.pathDestination = null;
    this.path = [];
    this.pathTime = 0;
    this.cannotFindPath = false;

    this.threadUpdateParts = threadBaseRoom('update_parts', UPDATE_PARTS_INTERVAL)(this.updateParts.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('warparty_run');

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.end();
    }


    // TODO use a war party specific topic for notifying of target change
    const targetRoom = this.targetRoom;
    const flag = this.getFlag();
    const creeps = this.getAssignedCreeps();
    const targetRoomObject = Game.rooms[targetRoom];
    const positionRoomObject = Game.rooms[this.position.roomName];

    const targetRoomEntry = kernel.getScribe().getRoomById(targetRoom);
    if (!targetRoomEntry) {
      trace.end();
      trace.error('no target room entry', {targetRoom});
      return running();
    }

    const baseRoom = getBasePrimaryRoom(base);
    if (!baseRoom) {
      trace.end();
      trace.error('no base room', {base: this.baseId});
      return running();
    }

    // If no parts, update parts
    if (!this.parts) {
      this.updateParts(trace, kernel, base, baseRoom, targetRoomEntry);
    } else {
      this.threadUpdateParts(trace, kernel, base, baseRoom, targetRoomEntry);
    }

    if (!targetRoom) {
      trace.error('no target room, terminating war party');
      this.party.done();
    }

    if (!flag) {
      trace.error(`no flag (${this.flagId}), terminating war party`);
      this.party.done();
    } else {
      trace.info('war party run', {
        id: this.id,
        flag: flag.name,
        baseId: base.id,
        primaryRoomId: base.primary,
        targetRoom,
        phase: this.phase,
        position: this.position,
        roomDamage: this.roomDamage,
        formation: this.getFormation(),
        previousPositions: this.getPreviousPositions(),
        creeps: creeps.length,
      });

      this.setHeal(trace);

      let targetPosition = new RoomPosition(25, 25, this.targetRoom);

      const roomEntry = kernel.getScribe().getRoomById(this.targetRoom);
      if (!roomEntry) {
        trace.info(`no room entry for ${this.targetRoom}, using center of room`);
        // TODO should probably delay until we have a room entry
      } else if (roomEntry.spawnLocation) {
        trace.info('setting spawn as target position', {pos: roomEntry.spawnLocation});
        // TODO fix issue with restored from memory room positions not having functions
        targetPosition = new RoomPosition(roomEntry.spawnLocation.x, roomEntry.spawnLocation.y,
          roomEntry.spawnLocation.roomName);
      } else if (roomEntry.controller?.pos) {
        trace.info('setting controller as target position', {pos: roomEntry.controller.pos});
        // TODO fix issue with restored from memory room positions not having functions
        targetPosition = new RoomPosition(roomEntry.controller.pos.x, roomEntry.controller.pos.y,
          roomEntry.controller.pos.roomName);
      }

      if (this.phase === Phase.PHASE_MARSHAL) {
        // If we have at least 4 creeps and they are in position, begin deployment
        if (this.inPosition(this.position, trace) && creeps.length >= 4) {
          this.phase = Phase.PHASE_EN_ROUTE;
          trace.info('moving to en route phase', {phase: this.phase});
        } else {
          this.setDestination(targetPosition, 3);
          this.position = flag.pos;
          this.marshal(this.position, creeps, trace);
        }
      }

      if (this.phase === Phase.PHASE_EN_ROUTE) {
        // If we are out of creep, remarshal
        if (!creeps.length || (this.position.findClosestByRange(creeps)?.pos.getRangeTo(this.position) > 5)) {
          this.phase = Phase.PHASE_MARSHAL;
          trace.info('moving to marshal phase', {phase: this.phase});
        } else if (targetRoom === this.position.roomName) {
          this.phase = Phase.PHASE_ATTACK;
          trace.info('moving to attack phase', {phase: this.phase});
        } else {
          this.setDestination(targetPosition, 3);
          this.deploy(kernel, positionRoomObject, targetRoom, creeps, trace);
        }
      }

      if (this.phase === Phase.PHASE_ATTACK) {
        const numPartyInTargetRoom = this.getAssignedCreeps().
          filter((creep) => creep.room.name === this.targetRoom).length;

        if (!numPartyInTargetRoom || !targetRoomObject || !creeps.length ||
          this.position.findClosestByRange(creeps)?.pos.getRangeTo(this.position) > 5) {
          this.phase = Phase.PHASE_MARSHAL;

          const roomName = base.primary;
          const roomObject = Game.rooms[roomName];
          if (!roomObject) {
            trace.error(`no room object for ${roomName}`);
          }

          const energyCapacityAvailable = roomObject.energyCapacityAvailable;
          this.minEnergy = _.min([this.minEnergy + 1000, energyCapacityAvailable]);
          this.party.setMinEnergy(this.minEnergy);

          trace.info('moving to marshal phase', {phase: this.phase});
        } else {
          const done = this.engage(kernel, targetRoomObject, creeps, trace);
          if (done) {
            trace.notice('done, notify war manager that room is cleared', {targetRoom: this.targetRoom});

            // Inform that attack is completed
            const attackUpdate: AttackRequest = {
              status: AttackStatus.COMPLETED,
              roomId: targetRoom,
            };
            kernel.getTopics().addRequest(TOPICS.ATTACK_ROOM, 1, attackUpdate, ATTACK_ROOM_TTL);

            // TODO go into waiting for orders phase

            // Done, terminate
            this.party.done();
          }
        }
      }
    }

    if (this.cannotFindPath) {
      trace.error('cannot find path, terminating war party');
      // Terminate party
      this.party.done();
    }

    // Tick the party along
    const partyResult = this.party.run(kernel, trace);
    if (partyResult.status === STATUS_TERMINATED) {
      trace.info('party terminated');
      trace.end();
      return partyResult;
    }

    if (global.LOG_WHEN_PID === this.id) {
      new RoomVisual(this.position.roomName).text('x', this.position.x, this.position.y);
      this.visualizePathToTarget(kernel, this.position, this.destination, this.range, trace);
    }

    trace.end();

    return running();
  }

  updateParts(trace: Tracer, kernel: Kernel, base: Base, baseRoom: Room, targetRoomEntry: RoomEntry): void {
    const boosts = newMultipliers();

    const baseStorage = baseRoom.storage;
    if (baseStorage) {
      const availableHealingBoost = scoreStorageHealing(baseStorage);
      boosts[HEAL] = availableHealingBoost;
    }

    const availableEnergyCapacity = baseRoom.energyCapacityAvailable;
    const roomDamage = scoreRoomDamage(targetRoomEntry) / 4;
    const [parts, ok] = buildAttacker(roomDamage, availableEnergyCapacity, boosts, trace);
    if (!ok) {
      // TODO suicide?
      trace.error('failed to build parts', {roomDamage, availableEnergyCapacity, boosts});
      return;
    }

    trace.info('updating parts', {parts});
    this.setParts(parts);
    this.roomDamage = roomDamage;
  }

  marshal(position: RoomPosition, creeps: Creep[], trace: Tracer) {
    if (!creeps.length) {
      return;
    }

    this.position = this.getFlag().pos;
    this.setPosition(position, trace);
  }

  deploy(kernel: Kernel, room: Room, targetRoom: string, creeps: Creep[], trace: Tracer) {
    trace.info('deploy', {
      targetRoom,
      position: this.position,
      destination: this.destination,
    });

    const [nextPosition, direction, blockers] = this.getNextPosition(kernel, this.position, this.destination, this.range, trace);

    trace.info('next position', {targetRoom, nextPosition, blockers: blockers.map((blocker) => blocker.id)});

    if (nextPosition) {
      trace.info('setting next position', {nextPosition});
      this.setPosition(nextPosition, trace);
    } else {
      trace.info('no next position');
    }

    // Update direction
    this.direction = direction;

    let targets: (Creep | Structure)[] = [];

    const dontAttack = kernel.getConfig().friends.concat(kernel.getConfig().neutral);

    if (room) {
      // determine target (hostile creeps, towers, spawns, nukes, all other structures)
      targets = targets.concat(room.find(FIND_HOSTILE_CREEPS, {
        filter: (creep) => dontAttack.indexOf(creep.owner.username) === -1,
      }));
    }

    if (blockers.length) {
      trace.info('blockers', {blocked: blockers.map((structure) => structure.id)});
      targets = targets.concat(blockers);
    }

    if (targets.length) {
      targets = _.sortBy(targets, (target) => {
        return creeps[0].pos.getRangeTo(target);
      });

      trace.info('targets', {targetsLength: targets.length});
      const target = this.party.setTarget(targets, trace);
      if (target) {
        this.alignWithTarget(target, nextPosition, trace);
      }
    } else {
      trace.info('no targets');
    }
  }

  engage(kernel: Kernel, room: Room, creeps: Creep[], trace: Tracer): boolean {
    let destination = new RoomPosition(25, 25, this.targetRoom);
    let range = 3;
    if (room && room.controller) {
      destination = room.controller.pos;
    }

    let targets = [];

    // If we have visibility into the room, get targets and choose first as destination
    if (room) {
      if ((room.controller?.safeMode || 0) > 500) {
        trace.notice('room is in safe mode, ending party');
        return true;
      }

      targets = this.getTargets(kernel, room);
      if (targets.length) {
        trace.info('target', targets[0]);
        destination = targets[0].pos;
        range = 1;
      } else if (room.controller?.my) {
        trace.info('room is owned by me, ending party');
        return true;
      } else if (room.controller?.level > 0) {
        trace.info('no targets, but room level is > 0, not ending party');
      } else {
        trace.info('no targets, done');
        return true;
      }
    }

    this.setDestination(destination, range);

    const [nextPosition, direction, blockers] = this.getNextPosition(kernel, this.position,
      this.destination, this.range, trace);
    trace.info('next position', {nextPosition, blockers: blockers.map((blocker) => blocker.id)});

    // Commented this out until direction actually matters
    // const directionChanged = direction != this.direction;
    // if (directionChanged) {
    //  trace.info("changing direction", {direction});
    //  this.setDirection(direction);
    // } else
    if (nextPosition) {
      trace.info('setting next position', {nextPosition});
      this.setPosition(nextPosition, trace);
    } else {
      trace.info('no next position');
    }

    // Update direction
    this.direction = direction;

    let nearbyTargets: WarPartyTarget[] = [];

    if (room) {
      const friends = kernel.getConfig().friends;
      // determine target (hostile creeps, towers, spawns, nukes, all other structures)
      nearbyTargets = nearbyTargets.concat(this.position.findInRange(FIND_HOSTILE_CREEPS, 2, {
        filter: (creep) => friends.indexOf(creep.owner.username) === -1,
      }));
    }

    if (blockers.length) {
      trace.info('blockers', {blocked: blockers.map((structure) => structure.id)});
      nearbyTargets = nearbyTargets.concat(blockers);
    }

    // Add other targets
    if (targets.length) {
      nearbyTargets = nearbyTargets.concat(targets);
    }

    if (nearbyTargets.length) {
      nearbyTargets = _.sortBy(nearbyTargets, (target) => {
        return this.position.getRangeTo(target);
      });

      trace.info('nearby targets', {nearByTargetsLength: nearbyTargets.length});
      const target = this.party.setTarget(nearbyTargets, trace);
      if (target) {
        this.alignWithTarget(target, nextPosition, trace);
      }
    } else {
      trace.info('no targets');
      return false;
    }

    return false;
  }

  alignWithTarget(target: (Creep | Structure), position: RoomPosition, trace: Tracer) {
    let inCorner: DirectionConstant = null;
    for (const [direction, corner] of CORNERS) {
      if (!corner) {
        return;
      }

      trace.info('corner', {corner, direction});

      const x = _.min([_.max([this.position.x + corner.x, 0]), 49]);
      const y = _.min([_.max([this.position.y + corner.y, 0]), 49]);
      const cornerPosition = new RoomPosition(x, y, this.position.roomName);

      trace.info('cornerPosition', {cornerPosition});
      if (target.pos.isEqualTo(cornerPosition)) {
        inCorner = direction;
      }
    }

    if (inCorner) {
      trace.info('in corner', {inCorner});

      const sides = ADJACENT_SIDES.get(inCorner);
      if (sides.length) {
        trace.info('sides', {sides});

        const side = _.find(sides, (side) => {
          const shiftedPosition = this.party.shiftPosition(position, side);
          return !this.isBlocked(shiftedPosition, trace);
        });

        if (side) {
          trace.info('side', {side});

          const shiftPosition = this.party.shiftPosition(position, side);
          if (shiftPosition) {
            trace.info('shifting position', {shiftPosition});
            this.setPosition(shiftPosition, trace);
          }
        }
      }
    }
  }

  getTargets(kernel: Kernel, room: Room): (Creep | Structure)[] {
    const friends = kernel.getConfig().friends;

    let targets: (Structure | Creep)[] = [];
    // determine target (hostile creeps, towers, spawns, nukes, all other structures)

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_TOWER &&
        friends.indexOf(structure.owner.username) === -1,
    }));

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_SPAWN &&
        friends.indexOf(structure.owner.username) === -1,
    }));

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_NUKER &&
        friends.indexOf(structure.owner.username) === -1,
    }));

    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType === STRUCTURE_CONTROLLER) {
          return false;
        }

        return friends.indexOf(structure.owner.username) === -1;
      },
    }));

    // Remove walls by controller so our reservers can block upgrading
    if (room.controller) {
      const wallsNearController = room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (structure) => {
          return structure.structureType === STRUCTURE_WALL ||
            structure.structureType === STRUCTURE_RAMPART;
        },
      });
      targets = targets.concat(wallsNearController);
    }

    targets = targets.concat(room.find(FIND_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType === STRUCTURE_CONTROLLER) {
          return false;
        }

        if (structure instanceof OwnedStructure && structure.owner) {
          const structureOwner = structure.owner.username;
          if (structureOwner && kernel.getConfig().friends.indexOf(structureOwner) !== -1) {
            return false;
          }

          return true;
        }

        const roomOwner = structure.room.controller?.owner?.username;
        if (roomOwner && kernel.getConfig().friends.indexOf(roomOwner) !== -1) {
          return false;
        }

        return true;
      },
    }));

    return targets;
  }

  setParts(parts: BodyPartConstant[]) {
    this.parts = parts;
    this.party.setParts(parts);
  }

  getPreviousPositions(): RoomPosition[] {
    return this.party.getPreviousPositions();
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

  visualizePathToTarget(kernel: Kernel, origin: RoomPosition, destination: RoomPosition, range: number, trace) {
    const path = this.getPath(kernel, origin, destination, range, trace);
    if (!path) {
      trace.log('no path to visualize');
      return;
    }

    visualizePath(path, trace);
  }

  getPath(kernel: Kernel, origin: RoomPosition, destination: RoomPosition, range: number, trace: Tracer) {
    trace.info('get path', {path: this.path, pathDestination: this.pathDestination, destination});

    if (this.path && this.pathDestination && this.pathDestination.isEqualTo(destination) &&
      Game.time - this.pathTime < 50) {
      trace.info('path cache hit', {pathLength: this.path.length, ttl: Game.time - this.pathTime, origin, destination});
      return this.path;
    }

    trace.info('war party path cache miss', {origin, destination});

    this.pathDestination = destination;
    this.pathComplete = false;
    this.pathTime = Game.time;

    warPartyQuadPolicy.destination.range = range;
    let [result, debug] = getPath(kernel, origin, destination, warPartyQuadPolicy, trace);

    trace.info('quad search', {
      origin: origin,
      destination: destination,
      result,
      debug,
    });

    if (result && !result.incomplete) {
      this.setFormation(FORMATION_QUAD);
    } else {
      warPartySingleFilePolicy.destination.range = range;
      [result, debug] = getPath(kernel, origin, destination, warPartySingleFilePolicy, trace);

      trace.info('single file search', {
        origin: origin,
        destination: destination,
        result,
        debug,
      });

      // set single file formation
      this.setFormation(FORMATION_SINGLE_FILE);
    }

    if (!result) {
      this.path = [];
      this.pathComplete = false;
    } else {
      // Add origin to beginning so we have our current position as start/rally point
      // this.path = [origin].concat(result.path);
      this.path = result.path;
      this.path = [origin].concat(this.path);
      this.pathComplete = !result.incomplete;
    }

    return this.path;
  }

  getNextPosition(kernel: Kernel, currentPosition: RoomPosition, destination: RoomPosition,
    range: number, trace: Tracer): [RoomPosition, DirectionConstant, WarPartyTarget[]] {
    // Figure out where we are going
    const path = this.getPath(kernel, currentPosition, destination, range, trace);
    if (!path) {
      // Cant find where we are going, freeze
      // TODO maybe suicide
      this.cannotFindPath = true;
      trace.warn('warparty stuck', {id: this.id});
      return [currentPosition, this.direction, []];
    }

    if (path.length === 0) {
      trace.error('no path', {id: this.id, currentPosition, destination, path});
      this.cannotFindPath = true;
      return [currentPosition, this.direction, []];
    }

    this.cannotFindPath = false;

    // We know where we are going and the path
    trace.info('path found', {pathLength: path.length, currentPosition, destination});

    // Work out the closest position along the path and it's distance
    // Scan path and find closest position, use that as as position on path
    const currentIndex = _.findIndex(path, (position) => {
      return position.isEqualTo(currentPosition);
    });

    // Log a message if we could not find an index, should not happen
    if (currentIndex < 0) {
      trace.warn('could not find origin/creep index', {currentIndex, currentPosition, path});
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
      trace.info('no next position', {nextIndex, path});
      return [currentPosition, this.direction, []];
    }

    let direction: DirectionConstant = this.direction;

    // Determine if we plan to move
    const positionChanged = !currentPosition.isEqualTo(nextPosition);
    if (positionChanged) {
      direction = currentPosition.getDirectionTo(nextPosition);
    }

    // Check if our path is blocked
    let blockers: WarPartyTarget[] = [];
    if (direction && currentPosition.roomName === nextPosition.roomName) {
      blockers = this.getBlockingObjects(nextPosition, direction, trace);
    }

    // We are blocked, don't move and instead clear blockage
    if (blockers.length) {
      trace.info('blocked', {blockers, nextPosition, direction});
      nextPosition = currentPosition;
    }

    trace.info('get next position', {
      positionChanged,
      currentIndex,
      currentPosition,
      direction,
      blockers: blockers.map((blocker) => blocker.id),
      nextIndex,
      nextPosition,
      pathLength: path.length,
      destination,
    });

    return [nextPosition, direction, blockers];
  }


  setFormation(formation: FORMATION_TYPE) {
    this.party.setFormation(formation);
  }

  getFormation(): FORMATION_TYPE {
    return this.party.getFormation();
  }

  setDestination(destination: RoomPosition, range: number) {
    this.destination = destination;
    this.range = range;
  }

  setDirection(direction: DirectionConstant) {
    this.party.setDirection(direction);
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

  getBlockingObjects(position: RoomPosition, direction: DirectionConstant, trace: Tracer): WarPartyTarget[] {
    return this.party.getBlockingObjects(position, direction, trace);
  }

  onEdge() {
    return this.position.x === 1 || this.position.x >= 48 || this.position.y <= 1 ||
      this.position.y === 49;
  }

  setPosition(position: RoomPosition, _trace: Tracer) {
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
