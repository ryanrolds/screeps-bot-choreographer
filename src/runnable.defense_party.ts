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

    const creeps = this.getAssignedCreeps();
    if (creeps.length < 1) {
      return sleeping(REQUEST_PARTY_MEMBER_TTL)
    }

    // Check existence of flag
    let flag = this.getFlag();
    if (!flag) {
      trace.log("no flag with that id, terminating", {flagId: this.flagId});
      return terminate();
    }

    const position = this.getPosition();

    trace.log('defense party run', {
      id: this.id,
      creeps: creeps.map(creep => creep.id),
      flagId: this.flagId,
      noTargetTTL: this.noTargetTTL,
      position,
    });

    // If destination is not party of a colony, terminate
    const orgRoom: Room = kingdom.getRoomByName(position.roomName);
    if (!orgRoom) {
      trace.log('not part of a colony, terminate party');
      return terminate();
    }

    // Get target requests and map to creeps
    const targetRequests: Creep[] = (orgRoom as any).getFilteredRequests(TOPICS.PRIORITY_TARGETS, (request) => {
      return request.details.roomName === orgRoom.id;
    }).map((request) => {
      return Game.getObjectById(request.details.id);
    }).filter((creep) => {
      return creep;
    });

    trace.log('target requests', {targetRequests: targetRequests.map(target => target.id)});

    // Select target from request; if no requests and its been a while, return to flag
    let destination = this.getPosition();
    if (targetRequests.length) {
      this.noTargetTTL = NO_TARGET_TTL;
      destination = targetRequests[0].pos
    } else {
      this.noTargetTTL -= 1;
      if (this.noTargetTTL < 0 && flag) {
        destination = flag.pos;
      }
    }

    trace.log('targets', {destination, targetRequests});

    this.setPosition(destination, trace);
    this.setTarget(targetRequests, trace);
    this.setHeal(trace);

    const partyResult = this.party.run(kingdom, trace);
    if (partyResult.status === STATUS_TERMINATED) {
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

  setTarget(targetRequests: Creep[], trace: Tracer) {
    this.party.setTarget(targetRequests, trace);
  }

  setHeal(trace: Tracer) {
    this.party.setHeal(trace);
  }
}
