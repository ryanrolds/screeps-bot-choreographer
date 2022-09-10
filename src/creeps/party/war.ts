/**
 * War Party
 *
 * Created by the War Manager, this logic controls a quad/party of Attacker creeps. The logic is broken
 * into 4 phases:
 *
 *   1. Marshalling - wait in designated area until all creeps are present
 *   2. Deployment  - move to target room, adjusting formation as needed
 *   3. Attack - once in the target room, look at the enemy structures and creeps and determine how to attack
 *
 * Party/individual movement logic is contained in the Party logic. This logic directs the group
 * and makes decisions on how to approach and attack the target. It's analogous to a Squad Leader.
 *
 * Strategies:
 *   * Maintain enemy damage/healing influence map ("kill zone")
 *     * Kill zone may be empty if party has a strong tank
 *   * Keep distance from towers/creeps if they can break the quads tank ("kill zone")
 *   * Attack creeps and structures not in "kill zone"
 *   * If room out of energy, reduce kill zone slowly
 *     * Avoid rushing in and tower being refilled and not having enough time to leave kill zone
 *   * Focus on nearby creeps (threat sorted), key structures, remaining creeps and structures, walls
 *
 * Threads:
 *   * Kill Zone update
 *   * Parts - based on max kill zone damage
 *   * Request creeps
 *   * Primary - heal, move, attack
 */
import * as _ from 'lodash';
import {Temperaments} from '../../config';
import {Phase} from '../../constants/attack';
import {DEFINITIONS, WORKER_ATTACKER} from '../../constants/creeps';
import {PRIORITY_ATTACKER} from '../../constants/priorities';
import {AllowedCostMatrixTypes} from '../../lib/costmatrix_cache';
import {Vector} from '../../lib/muster';
import {FindPathPolicy, getPath, visualizePath} from '../../lib/pathing';
import {DIRECTION_OFFSET} from '../../lib/position';
import {Tracer} from '../../lib/tracing';
import {Base, getBasePrimaryRoom} from '../../os/kernel/base';
import {Kernel} from '../../os/kernel/kernel';
import {PersistentMemory} from '../../os/memory';
import {RunnableResult, running, STATUS_TERMINATED} from '../../os/process';
import {BaseRoomThreadFunc, threadBaseRoom} from '../../os/threads/base_room';
import {buildAttacker, newMultipliers} from '../builders/attacker';
import {scoreRoomDamage, scoreStorageHealing} from '../scoring';
import PartyRunnable, {FORMATION_QUAD, FORMATION_SINGLE_FILE, FORMATION_TYPE, MAX_PARTY_SIZE} from './party';

const REQUEST_ATTACKER_TTL = 30;
const UPDATE_PARTS_INTERVAL = 50;
const WAR_PARTY_ROLE = WORKER_ATTACKER;

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

type WarPartyMemory = {
  phase: Phase;
  position: RoomPosition;
  destination: RoomPosition;
  range: number;
  direction: DirectionConstant;
  formation: FORMATION_TYPE;
  previousPositions: RoomPosition[];
}

export default class WarPartyRunnable extends PersistentMemory<WarPartyMemory> {
  private id: string;
  private baseId: string;
  private targetRoom: string;
  private createdAt: number;
  private muster: Vector;

  // persists in memory
  private phase: Phase;
  private position: RoomPosition;
  private destination: RoomPosition;
  private range: number;
  private direction: DirectionConstant;
  private formation: FORMATION_TYPE;
  private previousPositions: RoomPosition[];

  // parts
  private parts: BodyPartConstant[];
  private roomDamage: number;
  private minEnergy: number;

  // current path state
  private path: RoomPosition[];
  private pathDestination: RoomPosition;
  private pathTime: number;
  private party: PartyRunnable;

  // update parts based on changing target room damage
  private threadUpdateParts: BaseRoomThreadFunc;

  constructor(id: string, kernel: Kernel, base: Base, targetRoom: string, muster: Vector, createdAt: number,
    trace: Tracer) {
    super(id);

    // Minimum fields
    this.id = id;
    this.baseId = base.id;
    this.targetRoom = targetRoom;
    this.createdAt = createdAt;
    this.muster = muster;

    this.phase = Phase.PHASE_MARSHAL;
    this.position = this.muster.pos;
    this.destination = new RoomPosition(25, 25, targetRoom);
    this.range = 3;
    this.direction = BOTTOM;
    this.formation = FORMATION_QUAD;

    // Check if memory needs restored
    this.restoreMemory(trace);

    this.party = new PartyRunnable(this.id, this.baseId, this.previousPositions, WAR_PARTY_ROLE, [],
      this.minEnergy, PRIORITY_ATTACKER, REQUEST_ATTACKER_TTL);
    this.party.setDirection(this.direction);
    this.party.setFormation(this.formation);


    // set previous positions to muster line
    const previousPositions = [];
    for (let i = 0; i < MAX_PARTY_SIZE; i++) {
      const x = this.position.x + DIRECTION_OFFSET[muster.direction].x * i;
      const y = this.position.y + DIRECTION_OFFSET[muster.direction].y * i;
      previousPositions.push(new RoomPosition(x, y, this.position.roomName));
    }
    this.previousPositions = previousPositions;

    const targetRoomEntry = kernel.getScribe().getRoomById(targetRoom);
    if (!targetRoomEntry) {
      this.updateMemory(trace);
      trace.end();
      trace.error('no target room entry', {targetRoom});
      throw new Error('no target room entry');
    }

    const baseRoom = getBasePrimaryRoom(base);
    if (!baseRoom) {
      this.updateMemory(trace);
      trace.end();
      trace.error('no base room', {base: this.baseId});
      throw new Error('no base room');
    }

    this.updateParts(trace, kernel, base);
    this.roomDamage = null;
    this.minEnergy = DEFINITIONS.get(WAR_PARTY_ROLE)?.energyMinimum || 0;

    this.pathDestination = null;
    this.path = [];
    this.pathTime = 0;

    this.threadUpdateParts = threadBaseRoom('update_parts', UPDATE_PARTS_INTERVAL)(this.updateParts.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('warparty_run');

    // if we do not have a target, end party
    const targetRoom = this.targetRoom;
    if (!targetRoom) {
      trace.error('no target room, terminating war party');
      // Party will terminate itself and cause War Party to terminate
      this.party.done();
    }

    // if bot is passive and no aggression flag for base, end party
    const baseAggressiveFlag = Game.flags[`aggressive_${this.baseId}`];
    if (kernel.getConfig().temperament === Temperaments.Passive && !baseAggressiveFlag) {
      trace.error('No aggressive flag');
      // Party will terminate itself and cause War Party to terminate
      this.party.done();
    }

    // get base, if base not found end party
    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.warn('base not found', {baseId: this.baseId});
      // Party will terminate itself and cause War Party to terminate
      this.party.done();
    }

    trace.info('war party run', {
      id: this.id,
      baseId: base.id,
      primaryRoomId: base.primary,
      targetRoom,
      muster: this.muster,
      phase: this.phase,
      position: this.position,
      roomDamage: this.roomDamage,
      formation: this.getFormation(),
      previousPositions: this.getPreviousPositions(),
      creeps: this.getAssignedCreeps().length,
    });

    this.threadUpdateParts(trace, kernel, base);
    this.attackLogic(kernel, base, trace)

    // Tick the party along
    const partyResult = this.party.run(kernel, trace);
    if (partyResult.status === STATUS_TERMINATED) {
      this.updateMemory(trace);
      trace.info('party terminated');
      trace.end();
      return partyResult;
    }

    if (global.LOG_WHEN_PID === this.id) {
      new RoomVisual(this.position.roomName).text('x', this.position.x, this.position.y);
      this.visualizePathToTarget(kernel, this.position, this.destination, this.range, trace);
    }

    this.updateMemory(trace);
    trace.end();
    return running();
  }

  restoreMemory(trace: Tracer): void {
    const memory = this.getMemory(trace);
    if (memory.phase) {
      this.phase = memory.phase;
    }
    if (memory.position) {
      this.position = new RoomPosition(memory.position.x, memory.position.y, memory.position.roomName);
    }
    if (memory.destination) {
      this.destination = new RoomPosition(memory.destination.x, memory.destination.y, memory.destination.roomName);
    }
    if (memory.range) {
      this.range = memory.range;
    }
    if (memory.previousPositions) {
      this.previousPositions = memory.previousPositions.map((pos) => {
        return new RoomPosition(pos.x, pos.y, pos.roomName)
      });
    }
    if (memory.direction) {
      this.direction = memory.direction;
    }
    if (memory.formation) {
      this.formation = memory.formation;
    }
  }

  updateMemory(_trace: Tracer): void {
    this.setMemory({
      phase: this.phase,
      position: this.position,
      destination: this.destination,
      range: this.range,
      direction: this.party.getDirection(),
      formation: this.party.getFormation(),
      previousPositions: this.party.getPreviousPositions(),
    });
  }

  updateParts(trace: Tracer, kernel: Kernel, base: Base): void {
    const targetRoom = this.targetRoom;
    const targetRoomEntry = kernel.getScribe().getRoomById(targetRoom);
    if (!targetRoomEntry) {
      trace.error('no target room entry', {targetRoom});
      return
    }

    const baseRoom = getBasePrimaryRoom(base);
    if (!baseRoom) {
      trace.error('no base room', {base: this.baseId});
      return
    }

    // TODO finish getting multipliers
    const boosts = newMultipliers();

    const baseStorage = baseRoom.storage;
    if (baseStorage) {
      const availableHealingBoost = scoreStorageHealing(baseStorage);
      boosts[HEAL] = availableHealingBoost;
    }

    const availableEnergyCapacity = baseRoom.energyCapacityAvailable;
    // We want at least one creep attacking per quad, so ensure tank works with 3 creeps
    const roomDamage = scoreRoomDamage(targetRoomEntry) / 4;
    const [parts, ok] = buildAttacker(roomDamage, availableEnergyCapacity, boosts, trace);
    if (!ok) {
      // TODO suicide?
      trace.error('failed to build parts', {roomDamage, availableEnergyCapacity, boosts});
      return;
    }

    trace.info('updating parts', {parts});
    this.setParts(parts);
    this.roomDamage = roomDamage; 6
  }

  attackLogic(kernel: Kernel, base: Base, trace: Tracer) {
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

    const creeps = this.getAssignedCreeps();
    const positionRoomObject = Game.rooms[this.position.roomName];

    // marshal
    if (this.phase === Phase.PHASE_MARSHAL) {
      this.marshal(creeps, targetPosition, trace);
    }

    // deploy
    if (this.phase === Phase.PHASE_EN_ROUTE) {
      this.deploy(kernel, positionRoomObject, this.targetRoom, creeps, trace);
    }

    // engage enemy room
    if (this.phase === Phase.PHASE_ATTACK) {
      const targetRoomObject = Game.rooms[this.targetRoom];
      this.engage(kernel, targetRoomObject, creeps, trace);
    }
  }

  marshal(creeps: Creep[], position: RoomPosition, trace: Tracer) {
    trace.info('marshalling', {creeps: creeps.length, position});

    this.setFormation(FORMATION_SINGLE_FILE);

    // If we have at least 4 creeps and they are in position, begin deployment
    if (this.inPosition(this.position, trace) && creeps.length >= 4) {
      this.phase = Phase.PHASE_EN_ROUTE;
      trace.info('moving to en route phase', {phase: this.phase});
    } else {
      this.setDestination(position, 3);
      this.position = this.muster.pos;
      this.setPosition(this.muster.pos, trace);
    }
  }

  deploy(kernel: Kernel, room: Room, targetRoom: string, creeps: Creep[], trace: Tracer) {
    trace.info('deploy', {
      targetRoom,
      position: this.position,
      destination: this.destination,
    });

    // If we are out of creep, remarshal
    if (!creeps.length || (this.position.findClosestByRange(creeps)?.pos.getRangeTo(this.position) > 5)) {
      this.phase = Phase.PHASE_MARSHAL;
      trace.info('moving to marshal phase', {phase: this.phase});
      return;
    } else if (targetRoom === this.position.roomName) {
      this.phase = Phase.PHASE_ATTACK;
      trace.info('moving to attack phase', {phase: this.phase});
      return
    }

    this.setDestination(targetPosition, 3);

    const [nextPosition, direction, blockers] = this.getNextPosition(kernel, this.position,
      this.destination, this.range, trace);

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
    this.setFormation(FORMATION_QUAD);

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
        kernel.getTopics().addRequest(TOPICS.ATTACK_ROOM, 1, attackUpdate, ATTACK_ROOM_TTL + Game.time);

        // TODO go into waiting for orders phase

        // Done, terminate
        this.party.done();
      }
    }

    -----------------------------

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
        // } else if (room.controller?.my) {
        //   trace.info('room is owned by me, ending party');
        //   return true;
        // } else if (room.controller?.level > 0) {
        //   trace.info('no targets, but room level is > 0, not ending party');
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

    // Hostile creeps
    targets = targets.concat(room.find(FIND_HOSTILE_CREEPS, {
      filter: (creep) => friends.indexOf(creep.owner.username) === -1,
    }));

    // Hostile structures
    targets = targets.concat(room.find(FIND_HOSTILE_STRUCTURES, {
      filter: (structure) => {
        if (structure.structureType === STRUCTURE_CONTROLLER ||
          structure.structureType === STRUCTURE_RAMPART) {
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

    // NOTE: testing room clearing behavior - 08/06/22
    // targets = targets.concat(room.find(FIND_STRUCTURES, {
    //   filter: (structure) => {
    //     if (structure.structureType === STRUCTURE_CONTROLLER) {
    //       return false;
    //     }

    //     if (structure instanceof OwnedStructure && structure.owner) {
    //       const structureOwner = structure.owner.username;
    //       if (structureOwner && kernel.getConfig().friends.indexOf(structureOwner) !== -1) {
    //         return false;
    //       }

    //       return true;
    //     }

    //     const roomOwner = structure.room.controller?.owner?.username;
    //     if (roomOwner && kernel.getConfig().friends.indexOf(roomOwner) !== -1) {
    //       return false;
    //     }

    //     return true;
    //   },
    // }));

    return targets;
  }

  setParts(parts: BodyPartConstant[]) {
    this.parts = parts;
    this.party.setParts(parts);
  }

  getPreviousPositions(): RoomPosition[] {
    return this.party.getPreviousPositions();
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
      trace.info('no path found', {origin, destination});
      this.path = [];
    } else {
      this.path = result.path;
      this.path = [origin].concat(this.path);
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
      trace.warn('warparty stuck', {id: this.id});
      return [currentPosition, this.direction, []];
    }

    if (path.length === 0) {
      trace.error('no path', {id: this.id, currentPosition, destination, path});
      return [currentPosition, this.direction, []];
    }

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
