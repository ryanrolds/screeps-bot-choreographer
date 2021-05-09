import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from './org.kingdom';
import DefensePartyRunnable from './runnable.defense_party';
import TOPICS from './constants.topics';

const DEFENSE_PARTY_PROCESS_PRIORITY = 2;
const TARGET_REQUEST_TTL = 1;

interface StoredDefenseParty {
  id: string;
  flagId: string;
  position: RoomPosition;
}

interface DefenseMemory {
  parties: StoredDefenseParty[];
}

export default class DefenseManager {
  id: string;
  scheduler: Scheduler;
  memory: DefenseMemory;
  defenseParties: DefensePartyRunnable[];

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.restoreFromMemory(trace);
  }

  private restoreFromMemory(trace: Tracer) {
    const memory = (Memory as any);
    if (!memory.defense) {
      memory.defense = {
        parties: [],
      };
    }

    this.memory = memory.defense;

    this.defenseParties = this.memory.parties.map((party) => {
      if (!party.id || !party.position) {
        return null;
      }

      party.position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);

      return this.createAndScheduleDefenseParty(party.id, party.flagId, party.position, trace);
    }).filter((party) => {
      return party
    });
  }

  createAndScheduleDefenseParty(id: string, flagId: string, position: RoomPosition, trace: Tracer): DefensePartyRunnable {
    const party = new DefensePartyRunnable(id, flagId, position)

    trace.log("creating defense party", {id, position});

    const process = new Process(id, 'defense_party', Priorities.DEFENCE, {
      run(kingdom: Kingdom, trace: Tracer): RunnableResult {
        return party.run(kingdom, trace);
      }
    });
    this.scheduler.registerProcess(process);

    return party;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);
    trace.log("defense manager run");

    // Removed old defense parties
    this.defenseParties = this.defenseParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    Object.values(Game.flags).forEach((flag) => {
      trace.log('flag', {flag})
      if (flag.name.startsWith('defend')) {
        const flagDefensePartyId = `${flag.name}_party`;
        trace.log('defend flag', {flagDefensePartyId})
        if (!this.scheduler.hasProcess(flagDefensePartyId)) {
          const party = this.createAndScheduleDefenseParty(flagDefensePartyId, flag.name, flag.pos, trace);
          this.defenseParties.push(party);
        }
      }
    });

    // Group defenders by room
    const roomDefenses = _.groupBy(this.defenseParties, (party) => {
      return party.position.roomName;
    });

    // Request topics
    Object.values(Game.rooms).forEach((room: Room) => {
      const orgRoom = kingdom.getRoomByName(room.name)
      if (!orgRoom) {
        return;
      }

      const hostiles = room.find(FIND_HOSTILE_CREEPS);
      hostiles.forEach((hostile) => {
        const details = {
          id: hostile.id,
          roomName: room.name,
        };

        trace.log('requesting target', {details});

        (orgRoom as any).sendRequest(TOPICS.PRIORITY_TARGETS, 1, details, TARGET_REQUEST_TTL)
      });
    });

    /*
    const roomScores = _.reduce(roomDefenses, (rooms, parties: DefensePartyRunnable[]) => {
      return rooms[] = parties.reduce((roomScore, party) => {
        return roomScore + party.creeps.reduce((partyScore, creep) => {
          return partyScore + scoreDefender(creep);
        }, 0);
      }, 0);
    }, {});
    */

    trace.log('room defenses', {roomDefenses});

    // Update memory
    (Memory as any).defense = {
      parties: this.defenseParties.map((party) => {
        return {
          id: party.id,
          flagId: party.flagId,
          position: party.position,
        };
      })
    };

    return running();
  }
}

function scoreDefender(defender: Creep): number {
  return 0;
};
