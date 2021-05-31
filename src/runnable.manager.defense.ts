import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import DefensePartyRunnable from './runnable.defense_party';
import TOPICS from './constants.topics';
import CREEPS from './constants.creeps';
import * as PRIORITIES from './constants.priorities';
import MEMORY from './constants.memory';
import Colony from './org.colony';
import {thread} from './os.thread';
import {DEFENSE_STATUS} from './defense';

const TARGET_REQUEST_TTL = 1;
const REQUEST_DEFENDERS_TTL = 25;
const DEFENSE_STATUS_TTL = 1;
const UPDATE_DEFENSE_STATS_TTL = 5;
const hostileParts = {
  'attack': true,
  'heal': true,
  'ranged_attack': true,
  'claim': true,
};

type Target = Creep | StructureInvaderCore;

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
  threadCheckColonyDefenses: any;
  threadReturnDefendersToStation: any;
  threadUpdateDefenseStats: any;

  constructor(id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.restoreFromMemory(trace);

    this.threadCheckColonyDefenses = thread(REQUEST_DEFENDERS_TTL, null, null)(checkColonyDefenses);
    this.threadReturnDefendersToStation = thread(REQUEST_DEFENDERS_TTL, null, null)(returnDefendersToStation);
    this.threadUpdateDefenseStats = thread(UPDATE_DEFENSE_STATS_TTL, null, null)(updateDefenseStats);
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

    const hostilesByColony = getHostilesByColony(kingdom, Object.values(Game.rooms), trace)
    trace.log('hostiles by colony', {hostilesByColony});

    const defendersByColony = getDefendersByColony(kingdom, Object.values(Game.rooms), trace)
    trace.log('defenders by colony', {defendersByColony});

    addHostilesToColonyTargetTopic(kingdom, hostilesByColony, trace);
    publishDefenseStatuses(kingdom, hostilesByColony, trace);

    this.handleDefendFlags(trace);
    this.threadCheckColonyDefenses(kingdom, hostilesByColony, trace);
    this.threadReturnDefendersToStation(kingdom, hostilesByColony, trace);
    this.threadUpdateDefenseStats(kingdom, hostilesByColony, defendersByColony, trace);

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
  return rooms.reduce<Record<string, (Creep | StructureInvaderCore)[]>>((colonies, room: Room) => {
    const orgRoom = kingdom.getRoomByName(room.name)
    if (!orgRoom) {
      return colonies;
    }

    const orgColony = orgRoom.getColony();
    if (!orgColony) {
      return colonies;
    }

    if (!colonies[orgColony.id]) {
      colonies[orgColony.id] = [];
    }

    // Add any hostiles
    let hostiles = room.find(FIND_HOSTILE_CREEPS);
    hostiles = hostiles.filter((hostile) => {
      const isFriendly = kingdom.getFriends().indexOf(hostile.owner.username) > -1;
      if (isFriendly) {
        const hostilePart = _.find(hostile.body, (part): boolean => {
          // If hostile has work part and near wall/rampart then view as hostole
          if (part.type === WORK && hostile.pos.findInRange(FIND_STRUCTURES, 5, {
            filter: (structure) => {
              return structure.structureType === STRUCTURE_RAMPART ||
                structure.structureType === STRUCTURE_WALL;
            }
          }).length > 0) {
            return true;
          }

          return hostileParts[part.type];
        });
        if (!hostilePart) {
          trace.log('non-hostile creep', {creepName: hostile.name, owner: hostile.owner.username});
          return false;
        }
      }

      trace.log('hostile creep', {creepName: hostile.name, owner: hostile.owner.username});

      return true;
    });
    if (hostiles.length) {
      colonies[orgColony.id] = colonies[orgColony.id].concat(...hostiles);
    }

    const invaderCores = room.find<StructureInvaderCore>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_INVADER_CORE;
      },
    });
    if (invaderCores.length) {
      colonies[orgColony.id] = colonies[orgColony.id].concat(...invaderCores);
    }

    return colonies;
  }, {});
}

function getDefendersByColony(kingdom: Kingdom, rooms: Room[], trace: Tracer) {
  return rooms.reduce<Record<string, (Creep)[]>>((colonies, room: Room) => {
    const orgRoom = kingdom.getRoomByName(room.name)
    if (!orgRoom) {
      return colonies;
    }

    const orgColony = orgRoom.getColony();
    if (!orgColony) {
      return colonies;
    }

    if (!colonies[orgColony.id]) {
      colonies[orgColony.id] = [];
    }

    // Add any defenders
    let defenders = room.find(FIND_MY_CREEPS, {
      filter: (creep) => {
        return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER ||
          creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER_DRONE;
      }
    });
    if (defenders.length) {
      colonies[orgColony.id] = colonies[orgColony.id].concat(...defenders);
    }

    return colonies;
  }, {});
}

function addHostilesToColonyTargetTopic(kingdom: Kingdom, hostilesByColony: Record<string, Target[]>,
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

      let priority = 1;
      if (hostile.room?.name === orgColony.primaryRoomId) {
        priority = 2;
      }

      if (hostile instanceof Creep) {
        priority += hostile.body.reduce((acc, part) => {
          if (part.type === HEAL) {
            acc += 0.1;
          } else if (part.type === WORK) {
            acc += 0.4;
          } else if (part.type === RANGED_ATTACK) {
            acc += 0.2;
          } else if (part.type === ATTACK) {
            acc += 0.3;
          }
          return acc;
        }, 0)
      }

      trace.log('requesting target', {details, priority});

      (orgColony as any).sendRequest(TOPICS.PRIORITY_TARGETS, priority, details, TARGET_REQUEST_TTL);
    });
  });
}

function publishDefenseStatuses(kingdom: Kingdom, hostilesByColony: Record<string, Target[]>, trace) {
  kingdom.getColonies().forEach((colony) => {
    const numHostiles = (hostilesByColony[colony.id] || []).length;
    const numDefenders = Object.values<Creep>(colony.getCreeps()).filter((creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === CREEPS.WORKER_DEFENDER;
    }).length;

    let status = DEFENSE_STATUS.GREEN;
    if (numHostiles && numDefenders) {
      status = DEFENSE_STATUS.YELLOW;
    } else if (numHostiles) {
      status = DEFENSE_STATUS.RED;
    }

    const details = {
      status,
      numHostiles,
      numDefenders,
    };

    trace.log('defense status update', details);

    (colony as any).sendRequest(TOPICS.DEFENSE_STATUSES, 0, details, DEFENSE_STATUS_TTL)
  });
}

function checkColonyDefenses(kingdom: Kingdom, hostilesByColony: Record<string, Creep[]>, trace: Tracer) {
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

    return kingdom.getRoomColony(flag.pos.roomName);
  });

  trace.log('station flags', {flags});

  flags.forEach((flag) => {
    const colony = kingdom.getRoomColony(flag.pos.roomName);
    if (!colony) {
      trace.log('cannot find colony for room', {roomName: flag.pos.roomName});
      return;
    }

    if (hostilesByColony[colony.id] && hostilesByColony[colony.id].length) {
      trace.log('hostiles present, not returning defenders');
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

function updateDefenseStats(kingdom: Kingdom, hostilesByColony: Record<string, Target[]>,
  defendersByColony: Record<string, Creep[]>, trace: Tracer) {
  const stats = kingdom.getStats();
  stats.defense = {
    defenderScores: _.mapValues(defendersByColony, (defender) => {
      return defender.reduce((total, defender) => {
        if (defender instanceof Creep) {
          total += scoreDefender(defender);
        }

        return total;
      }, 0)
    }),
    hostileScores: _.mapValues(hostilesByColony, (hostiles) => {
      return hostiles.reduce((total, hostile) => {
        if (hostile instanceof Creep) {
          total += scoreHostile(hostile);
        }

        return total;
      }, 0)
    }),
  };

  trace.log('defense stats', {defenseStats: stats.defense});
}

function scoreHostile(hostile: Creep): number {
  return hostile.body.reduce((acc, part) => {
    if (part.type === HEAL) {
      acc += 2;
    } else if (part.type === WORK) {
      acc += 3;
    } else if (part.type === RANGED_ATTACK) {
      acc += 1;
    } else if (part.type === ATTACK) {
      acc += 2;
    }
    return acc;
  }, 0)
}

function scoreDefender(defender: Creep): number {
  return defender.body.reduce((acc, part) => {
    if (part.type === HEAL) {
      acc += 2;
    } else if (part.type === RANGED_ATTACK) {
      acc += 1;
    } else if (part.type === ATTACK) {
      acc += 2;
    }
    return acc;
  }, 0)
};
