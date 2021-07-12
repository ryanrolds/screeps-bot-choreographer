import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import WarPartyRunnable from './runnable.warparty';
import {Phase} from './runnable.warparty';
import {trace} from 'node:console';
import {UNLOAD_LINK} from './constants.priorities';
import Colony from './org.colony';

const WAR_PARTY_PROCESS_PRIORITY = 2;

interface StoredWarParty {
  id: string;
  target: string;
  position: RoomPosition;
  colony: string;
  phase: Phase;
}

interface WarMemory {
  targetRoom: string;
  parties: StoredWarParty[];
}

export default class WarManager {
  id: string;
  scheduler: Scheduler;
  memory: WarMemory;
  warParties: WarPartyRunnable[];
  targetRoom: string;
  costMatrices: Record<string, CostMatrix>;

  constructor(kingdom: Kingdom, id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.warParties = null;
    this.costMatrices = {};
  }

  private restoreFromMemory(kingdom: Kingdom, trace: Tracer) {
    const memory = (Memory as any);

    trace.log("restore memory", {war: memory.war || null});

    if (!memory.war) {
      memory.war = {
        parties: [],
      };
    }

    this.memory = memory.war;

    this.targetRoom = (Memory as any).war?.targetRoom || null;
    this.warParties = this.memory.parties.map((party) => {
      trace.log("restoring party", {party});
      if (!party.id || !party.target || !party.position || !party.colony) {
        return null;
      }

      const position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      const colony = kingdom.getColonyById(party.colony);
      if (!colony) {
        trace.log('not create war party, cannot find colony', {colonyId: party.colony});
        return null;
      }

      return this.createAndScheduleWarParty(colony, party.id, party.target, party.phase,
        position, trace);
    }).filter((party) => {
      return party;
    });

    trace.notice("restore complete", {
      targetRoom: this.targetRoom,
      warParties: this.warParties.map(warParty => warParty.id),
    });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    if (this.warParties === null) {
      this.restoreFromMemory(kingdom, trace);
    }

    trace = trace.asId(this.id);

    this.warParties = this.warParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    trace.log("war manager run", {warPartyIds: this.warParties.map(warParty => warParty.id)});

    // Create minimum war parties
    if (this.warParties.length < 1) {
      this.createNewWarParty(kingdom, trace);
    }

    // Update memory
    (Memory as any).war = {
      targetRoom: this.targetRoom,
      parties: this.warParties.map((party) => {
        return {
          id: party.id,
          target: party.targetRoom,
          phase: party.phase,
          colony: party.getColony().id,
          position: party.getPosition(),
        };
      })
    };

    trace.log("storing war parties", {parties: (Memory as any).war});

    return sleeping(20);
  }

  getTargetRoom(): string {
    return this.targetRoom || null;
  }

  getCostMatrix(roomName: string): CostMatrix {
    if (!this.costMatrices[roomName]) {
      const costMatrix = new PathFinder.CostMatrix();


      this.costMatrices[roomName] = costMatrix;
    }

    return this.costMatrices[roomName];
  }

  createNewWarParty(kingdom: Kingdom, trace: Tracer) {
    const flag = Game.flags['rally'];
    if (!flag) {
      trace.log('not creating war party, no rally flag');
      return null;
    }

    const colony = kingdom.getRoomColony(flag.pos.roomName);
    if (!colony) {
      trace.log('not create war party, rally not in colony', {roomName: flag.pos.roomName});
      return null;
    }

    const partyId = `war_party_${this.targetRoom}_${Game.time}`;
    trace.log("creating war party", {target: this.targetRoom, partyId});
    const warParty = this.createAndScheduleWarParty(colony, partyId, this.targetRoom, Phase.PHASE_MARSHAL, flag.pos, trace);
    if (warParty) {
      this.warParties.push(warParty);
    }
  }

  createAndScheduleWarParty(colony: Colony, id: string, target: string, phase: Phase,
    position: RoomPosition, trace: Tracer): WarPartyRunnable {
    const party = new WarPartyRunnable(id, colony, 'rally', position, target, phase);
    const process = new Process(id, 'war_party', Priorities.OFFENSE, party);
    this.scheduler.registerProcess(process);

    return party;
  }
}
