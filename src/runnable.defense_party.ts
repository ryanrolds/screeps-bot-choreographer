import * as _ from 'lodash';
import {Kingdom} from './org.kingdom';
import {Colony} from './org.colony';
import {RunnableResult, running, sleeping, terminate, STATUS_TERMINATED} from "./os.process";
import {Tracer} from './lib.tracing';
import {WORKER_DEFENDER_DRONE} from './constants.creeps'
import {PRIORITY_BUFFER_PATROL} from "./constants.priorities";
import * as TOPICS from './constants.topics';
import Room from './org.room';
import PartyRunnable from './runnable.party';
import {find} from 'lodash';

const REQUEST_PARTY_MEMBER_TTL = 30;
const NO_TARGET_TTL = 20;

export default class DefensePartyRunnable {
  id: string;
  flagId: string;
  party: PartyRunnable;
  noTargetTTL: number;

  constructor(id: string, colony: Colony, flagId: string, position: RoomPosition, trace: Tracer) {
    this.id = id;
    this.flagId = flagId;
    this.noTargetTTL = 0;
    this.party = new PartyRunnable(id, colony, position, WORKER_DEFENDER_DRONE, PRIORITY_BUFFER_PATROL,
      REQUEST_PARTY_MEMBER_TTL);
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    trace.notice("defense party run top", {id: this.id})

    const prep = trace.begin('run_prep')
    // Check existence of flag
    let flag = this.getFlag();
    if (!flag) {
      trace.notice("no flag with that id, terminating", {flagId: this.flagId});
      prep.end();
      return terminate();
    }

    let colony = this.getColony();
    if (!colony) {
      trace.notice("no colony with that id, terminating");
      prep.end();
      return terminate();
    }

    const creeps = this.getAssignedCreeps();
    const position = this.getPosition();

    trace.log('defense party run', {
      id: this.id,
      creeps: creeps.map(creep => creep.name),
      flagId: this.flagId,
      noTargetTTL: this.noTargetTTL,
      position,
    });

    prep.end();

    const targetTrace = trace.begin('run_target');

    let targetCreeps: Creep[] = [];
    let targetStructures: Structure[] = [];
    // Get target requests and map to creeps
    if (flag.room) {
      const friends = kingdom.config.friends;
      targetCreeps = flag.room.find(FIND_HOSTILE_CREEPS).filter((creep) => {
        return friends.indexOf(creep.owner.username) === -1;
      });

      targetCreeps = _.sortBy(targetCreeps, (creep) => {
        return 50 - creep.getActiveBodyparts(ATTACK);
      });

      if (!flag.room.controller?.my && flag.room.controller?.reservation?.username !== kingdom.config.username) {
        targetStructures = flag.room.find(FIND_STRUCTURES, {
          filter: (structure) => {
            return structure.structureType === STRUCTURE_CONTAINER;
          }
        });
      }
    }

    let targets: (Creep | Structure)[] = [];
    targets = targets.concat(targetCreeps, targetStructures);

    trace.log('target requests', {targets: targets.map(target => target.id)});

    targetTrace.end();

    const movementTrace = trace.begin('run_movement');

    // Select target from request; if no requests and its been a while, return to flag
    let destination = this.getPosition();
    if (targets.length) {
      this.noTargetTTL = NO_TARGET_TTL;
      destination = targets[0].pos
    } else {
      this.noTargetTTL -= 1;
      if (this.noTargetTTL < 0 && flag) {
        destination = flag.pos;
      }
    }

    movementTrace.end();

    trace.log('goal', {destination, targets});

    const partyTrace = trace.begin('run_party');

    this.setPosition(destination, trace);
    this.setTarget(targets, trace);
    this.setHeal(trace);

    const partyResult = this.party.run(kingdom, trace);

    partyTrace.end();

    if (partyResult.status === STATUS_TERMINATED) {
      trace.notice('party terminated, terminate this');
      return partyResult;
    }

    return running();
  }

  getAssignedCreeps() {
    return this.party.getAssignedCreeps();
  }

  inPosition(position: RoomPosition, trace: Tracer) {
    return this.party.inPosition(position, trace);
  }

  getColony(): Colony {
    return this.party.getColony();
  }

  getFlag() {
    return Game.flags[this.flagId] || null;
  }

  getPosition() {
    return this.party.getPosition();
  }

  setPosition(position: RoomPosition, trace: Tracer) {
    this.party.setPosition(position);
  }

  setTarget(targets: (Creep | Structure)[], trace: Tracer) {
    this.party.setTarget(targets, trace);
  }

  setHeal(trace: Tracer) {
    this.party.setHeal(trace);
  }
}
