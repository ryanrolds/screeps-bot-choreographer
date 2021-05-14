import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from './org.kingdom';
import DefensePartyRunnable from './runnable.defense_party';
import TOPICS from './constants.topics';
import CREEPS from './constants.creeps';
import PRIORITIES from './constants.priorities';
import MEMORY from './constants.memory';
import Colony from './org.colony';
import {doEvery} from './lib.scheduler';

const TARGET_REQUEST_TTL = 1;
const REQUEST_DEFENDERS_TTL = 10;

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
  doCheckColonyDefenses: any;
  doReturnDefendersToStation: any;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.restoreFromMemory(trace);

    this.doCheckColonyDefenses = doEvery(REQUEST_DEFENDERS_TTL, null, null)(checkColonyDefenses);
    this.doReturnDefendersToStation = doEvery(REQUEST_DEFENDERS_TTL, null, null)(returnDefendersToStation);
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

    this.handleDefendFlags(trace);

    const hostilesByColony = getHostilesByColony(kingdom, Object.values(Game.rooms), trace)

    trace.log('hostiles by colony', {hostilesByColony});

    addHostilesToColonyTargetTopic(kingdom, hostilesByColony, trace);
    this.doCheckColonyDefenses(kingdom, hostilesByColony, trace);
    this.doReturnDefendersToStation(kingdom, hostilesByColony, trace);

    return running();
  }

  handleDefendFlags(trace: Tracer) {
    // Removed old defense parties
    this.defenseParties = this.defenseParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    Object.values(Game.flags).forEach((flag) => {
      if (flag.name.startsWith('defend')) {
        const flagDefensePartyId = `${flag.name}_party`;
        trace.log('defend flag', {flagDefensePartyId})
        if (!this.scheduler.hasProcess(flagDefensePartyId)) {
          const party = this.createAndScheduleDefenseParty(flagDefensePartyId, flag.name, flag.pos, trace);
          this.defenseParties.push(party);
        }
      }
    });

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
  }
}

function getHostilesByColony(kingdom: Kingdom, rooms: Room[], trace: Tracer) {
  return rooms.reduce<Record<string, Creep[]>>((colonies, room: Room) => {
    const orgRoom = kingdom.getRoomByName(room.name)
    if (!orgRoom) {
      return colonies;
    }

    const orgColony = orgRoom.getColony();
    if (!orgColony) {
      return colonies;
    }

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (!hostiles.length) {
      return colonies;
    }

    if (!colonies[orgColony.id]) {
      colonies[orgColony.id] = [];
    }

    colonies[orgColony.id] = colonies[orgColony.id].concat(...hostiles);

    return colonies;
  }, {});
}

function addHostilesToColonyTargetTopic(kingdom: Kingdom, hostilesByColony: Record<string, Creep[]>,
  trace: Tracer) {
  // Add targets to colony target topic
  _.forEach(hostilesByColony, (hostiles, colonyId) => {
    const orgColony = kingdom.getColonyById(colonyId);
    if (!orgColony) {
      trace.log('expect to find colony, but did not', {colonyId});
      return;
    }

    hostiles.forEach((hostile) => {
      const details = {
        id: hostile.id,
        roomName: hostile.room.name,
      };

      // TODO priority based on score
      const priority = 1;

      trace.log('requesting target', {details, priority});

      (orgColony as any).sendRequest(TOPICS.PRIORITY_TARGETS, priority, details, TARGET_REQUEST_TTL);
    });
  });
}

function checkColonyDefenses(kingdom: Kingdom, hostilesByColony: Record<string, Creep[]>,
  trace: Tracer) {
  // Check for defenders
  _.forEach(hostilesByColony, (hostiles, colonyId) => {
    const colony = kingdom.getColonyById(colonyId);
    if (!colony) {
      trace.log('expect to find colony, but did not', {colonyId});
      return;
    }

    const defenders = colony.getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER ||
        creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER_DRONE;
    });

    trace.log('colony threat status', {colonyId, numHostiles: hostiles.length, numDefenders: defenders.length});

    if (hostiles.length) {
      requestExistingDefenders(defenders, hostiles[0].pos);

      if (defenders.length < hostiles.length) {
        requestAdditionalDefenders(colony, hostiles.length - defenders.length, trace);
      }
    }
  });
}

function requestExistingDefenders(defenders: Creep[], position: RoomPosition) {
  const positionStr = [position.x, position.y, position.roomName].join(',');

  // Order existing defenders to the room and last known location
  defenders.forEach((defender) => {
    defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = position.roomName;
    defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = positionStr;
  });
}

function requestAdditionalDefenders(colony: Colony, needed: number, trace: Tracer) {
  for (let i = 0; i < needed; i++) {
    trace.log('requesting defender', {colonyId: (colony as any).id});

    colony.sendRequest(TOPICS.TOPIC_DEFENDERS, PRIORITIES.PRIORITY_DEFENDER, {
      role: CREEPS.WORKER_DEFENDER,
      spawn: true,
      memory: {}
    }, REQUEST_DEFENDERS_TTL);
  }
}

function returnDefendersToStation(kingdom: Kingdom, hostilesByColony: Record<string, Creep[]>, trace: Tracer) {
  const flags = Object.values(Game.flags).filter((flag) => {
    trace.log('flag', {flag})
    if (!flag.name.startsWith('station')) {
      return false;
    }

    if (!flag.room) {
      return false;
    }

    return kingdom.getRoomByName(flag.room.name)?.getColony();
  });

  flags.forEach((flag) => {
    const colony = kingdom.getRoomByName(flag.room.name)?.getColony()
    if (!colony) {
      return;
    }

    if (hostilesByColony[colony.id] && hostilesByColony[colony.id].length) {
      return;
    }

    const defenders = colony.getCreeps().filter((creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER ||
        creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER_DRONE;
    });

    trace.log('sending defenders back to station', {colonyId: colony.id, flagName: flag.name});
    requestExistingDefenders(defenders, flag.pos);
  });
}

function scoreDefender(defender: Creep): number {
  return 0;
};
