import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from './org.kingdom';
import WarPartyRunnable from './runnable.warparty';

const WAR_PARTY_PROCESS_PRIORITY = 2;

interface StoredWarParty {
  id: string;
  target: string;
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

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.restoreFromMemory();
  }

  private restoreFromMemory() {
    const memory = (Memory as any);
    if (!memory.war) {
      memory.war = {
        parties: [],
      };
    }

    this.memory = memory.war;

    this.targetRoom = (Memory as any).war?.targetRoom || 'E18S46';
    this.warParties = this.memory.parties.map((party) => {
      if (!party.id || !party.target) {
        return null;
      }

      return this.createAndScheduleWarParty(party.id, party.target);
    }).filter((party) => {
      return party
    });
  }

  createAndScheduleWarParty(id: string, target: string): WarPartyRunnable {
    const party = new WarPartyRunnable(id, target)
    const process = new Process(id, 'war_party', Priorities.OFFENSE, {
      run(kingdom: Kingdom, trace: Tracer): RunnableResult {
        return party.run(kingdom, trace);
      }
    })
    this.scheduler.registerProcess(process);

    return party;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    this.warParties = this.warParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    if (this.warParties.length < 1) {
      const partyId = `party_${this.targetRoom}_${Game.time}`;
      console.log("creating war party", this.targetRoom, partyId);
      this.warParties.push(this.createAndScheduleWarParty(partyId, this.targetRoom));
    }

    // Update memory
    (Memory as any).war = {
      targetRoom: this.targetRoom,
      parties: this.warParties.map((party) => {
        return {
          id: party.id,
          target: party.targetRoom
        };
      })
    };

    console.log("WarManager run");

    return sleeping(20);
  }
}
