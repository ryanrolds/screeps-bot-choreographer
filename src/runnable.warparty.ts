import * as _ from 'lodash';
import Kingdom from "./org.kingdom";
import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {WORKER_ATTACKER} from './constants.creeps'
import {PRIORITY_ATTACKER} from "./constants.priorities";
import {TOPIC_SPAWN} from './constants.topics';
import * as MEMORY from './constants.memory'

const MEMORY_WAR_PARTY = 'war_party';
const REQUEST_ATTACKER_TTL = 30;
const PHASE_FORMING = 'forming';
const PHASE_EN_ROUTE = 'en_route';
const PHASE_ATTACK = 'attack';

const FORMATION = [
  {x: -1, y: 1},
  {x: 0, y: 1},
  {x: -1, y: 0},
  {x: 0, y: 0},
];

export default class WarPartyRunnable {
  id: string;
  targetRoom: string;
  creeps: Creep[];
  creepRequestTTL: number;
  phase: string;
  rallyPoint: Flag;
  //position: RoomPosition;

  constructor(id: string, targetRoom: string) {
    this.id = id;
    this.targetRoom = targetRoom;
    this.creepRequestTTL = 0;
    this.phase = PHASE_FORMING;
    this.creeps = [];
    this.rallyPoint = Game.flags['rally'] || null;
    //this.position = new RoomPosition(25, 25, this.targetRoom);
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    console.log(`WarParty: ${this.id}, ${this.phase}, ${this.creeps.length}`);

    if (this.rallyPoint === null) {
      console.log("No rally point defined, terminating war party");
      return terminate();
    }

    let ready = false;
    if (this.phase === PHASE_FORMING) {
      ready = this.formParty(kingdom);
      if (ready) {
        this.phase = PHASE_EN_ROUTE;
      }
      // TODO refresh and boost phase
    } else if (this.phase === PHASE_EN_ROUTE) {
      ready = this.moveToTargetRoom();
      if (ready) {
        this.phase = PHASE_EN_ROUTE;
      }
    } else if (this.phase === PHASE_ATTACK) {
      this.engageEnemy();
    } else {
      console.log(`invalid war party phase: ${this.phase}`);
      return terminate();
    }

    return running();
  }

  formParty(kingdom: Kingdom): boolean {
    // once all all four creeps are in their assigned place, move to next phase

    this.creepRequestTTL--;
    if (this.creepRequestTTL < 1) {
      this.creeps = this.getAssignedCreeps();
      this.creepRequestTTL = REQUEST_ATTACKER_TTL;
      this.requestCreeps(kingdom, 4 - this.creeps.length);
    }

    return false;
  }

  moveToTargetRoom(): boolean {
    // TODO approach from room furthest from centroid of towers

    // move just in side of target room, move to next phase
    // if not in room, move to next room
    // if in neighboring room move to target room edge

    return false;
  }

  engageEnemy(): boolean {
    // heal
    // determine target (hostile creeps, towers, critical structures)
    // if in range of target, attack
    // if not adjacent to target, move towards target

    return false;
  }

  heal() {

  }

  attack() {

  }

  move() {

  }

  getAssignedCreeps() {
    const creeps = Object.values(Game.creeps).filter((creep) => {
      return creep.memory[MEMORY_WAR_PARTY] === this.id;
    })

    return _.sortBy(creeps, 'id')
  }

  requestCreeps(kingdom: Kingdom, numToRequest: number) {
    for (let i = 0; i < numToRequest; i++) {
      // Determine creeps position at rally point
      const x = this.rallyPoint.pos.x + FORMATION[i].x;
      const y = this.rallyPoint.pos.y + FORMATION[i].y;

      kingdom.sendRequest(TOPIC_SPAWN, PRIORITY_ATTACKER, {
        role: WORKER_ATTACKER,
        memory: {
          [MEMORY_WAR_PARTY]: this.id,
          // Tell creep to move to it's rally point position
          [MEMORY.MEMORY_POSITION_X]: x,
          [MEMORY.MEMORY_POSITION_Y]: y,
          [MEMORY.MEMORY_POSITION_ROOM]: this.rallyPoint.pos.roomName
        },
      }, REQUEST_ATTACKER_TTL);
    }
  }
}
