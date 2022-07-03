import * as _ from 'lodash';
import {Base, getBasePrimaryRoom} from './config';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TOPICS from './constants.topics';
import {DEFENSE_STATUS} from './constants.defense';
import {Tracer} from './lib.tracing';
import {Process, sleeping} from "./os.process";
import {RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from './os.thread';
import {scoreHealing} from './role.harasser';
import {createSpawnRequest, getBaseSpawnTopic, requestSpawn} from './runnable.base_spawning';
import DefensePartyRunnable from './runnable.defense_party';
import {getBaseDefenseTopic} from './topics';

const RUN_INTERVAL = 5;
const TARGET_REQUEST_TTL = RUN_INTERVAL;
const DEFENSE_STATUS_TTL = RUN_INTERVAL;
const REQUEST_DEFENDERS_TTL = 25;
const UPDATE_DEFENSE_STATS_TTL = 5;
const REQUEST_DEFENDER_TTL = 5;

export function getBasePriorityTargetsTopic(baseId: string): string {
  return `base_${baseId}_priority_targets`;
}

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
  threadCheckColonyDefenses: ThreadFunc;
  threadReturnDefendersToStation: ThreadFunc;
  threadUpdateDefenseStats: ThreadFunc;
  threadHandleDefenderRequest: ThreadFunc;

  constructor(kernel: Kernel, id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.restoreFromMemory(kingdom, trace);

    this.threadCheckColonyDefenses = thread('check_defense_thread', REQUEST_DEFENDERS_TTL)(checkColonyDefenses);
    this.threadReturnDefendersToStation = thread('recall_defenders_thread', REQUEST_DEFENDERS_TTL)(returnDefendersToStation);
    this.threadUpdateDefenseStats = thread('update_defense_stats_thread', UPDATE_DEFENSE_STATS_TTL)(updateDefenseStats);
    this.threadHandleDefenderRequest = thread('request_defenders_thread', REQUEST_DEFENDER_TTL)(this.requestDefenders.bind(this));
  }

  private restoreFromMemory(kernel: Kernel, trace: Tracer) {
    const memory = (Memory as any);
    if (!memory.defense) {
      memory.defense = {
        parties: [],
      };
    }

    this.memory = memory.defense;

    this.defenseParties = this.memory.parties.map((party) => {
      if (!party.id || !party.position || !party.flagId) {
        trace.error("invalid defense party", {party});
        return null;
      }

      party.position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      return this.createAndScheduleDefenseParty(kingdom, party.id, party.flagId, party.position, trace);
    }).filter((party) => {
      return !!party
    });
  }

  createAndScheduleDefenseParty(kernel: Kernel, id: string, flagId: string, position: RoomPosition,
    trace: Tracer): DefensePartyRunnable {

    const flag = Game.flags[flagId] || null;
    if (!flag) {
      trace.error('flag not found, not creating defense party', {flagId});
      return;
    }

    // TODO replace this with planner usage
    const colony = kingdom.getClosestColonyInRange(flag.pos.roomName, 5);
    if (!colony) {
      trace.error('could not find colony in range, not creating defense party', {roomName: flag.pos.roomName});
      return;
    }

    const base = kingdom.getPlanner().getBaseById(colony.id);
    if (!base) {
      trace.error('not create defense party, cannot find colony config', {colonyId: colony.id});
      return null;
    }

    trace.notice("creating defense party", {id, position, flagId, colonyId: colony.id});

    const party = new DefensePartyRunnable(id, base, flagId, position, trace)
    const process = new Process(id, 'defense_party', Priorities.DEFENCE, {
      run(kernel: Kernel, trace: Tracer): RunnableResult {
        return party.run(kingdom, trace);
      }
    });
    this.scheduler.registerProcess(process);

    return party;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('defense_manager_run');
    trace.log("defense manager run");

    const hostilesTrace = trace.begin('getHostilesByColony')
    const hostilesByColony = getHostilesByColony(kingdom, Object.values(Game.rooms), hostilesTrace)
    hostilesTrace.log('hostiles by colony', {hostilesByColony});
    hostilesTrace.end();

    const targetTopicTrace = trace.begin('addHostilesToColonyTargetTopic')
    addHostilesToColonyTargetTopic(kingdom, hostilesByColony, targetTopicTrace);
    targetTopicTrace.end();

    const defenseStatusTrace = trace.begin('updateDefenseStatus')
    publishDefenseStatuses(kingdom, hostilesByColony, defenseStatusTrace);
    defenseStatusTrace.end();

    this.handleDefendFlags(kingdom, trace);
    this.threadCheckColonyDefenses(trace, kingdom, hostilesByColony);
    this.threadReturnDefendersToStation(trace, kingdom, hostilesByColony);
    this.threadUpdateDefenseStats(trace, kingdom, hostilesByColony);
    this.threadHandleDefenderRequest(trace, kingdom, hostilesByColony);

    trace.end();

    return sleeping(RUN_INTERVAL);
  }

  private handleDefendFlags(kernel: Kernel, trace: Tracer) {
    // Removed old defense parties
    this.defenseParties = this.defenseParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    Object.values(Game.flags).forEach((flag) => {
      if (flag.name.startsWith('defend_')) {
        const flagDefensePartyId = `${flag.name}_party`;
        trace.log('defend flag', {flagDefensePartyId})
        if (!this.scheduler.hasProcess(flagDefensePartyId)) {
          const party = this.createAndScheduleDefenseParty(kingdom, flagDefensePartyId, flag.name, flag.pos, trace);
          this.defenseParties.push(party);
        }
      }
    });

    // Update memory
    (Memory as any).defense = {
      parties: this.defenseParties.map((party): StoredDefenseParty => {
        if (!Game.flags[party.flagId]) {
          trace.error("missing flag", {flagId: party.flagId});
          return null;
        }

        return {
          id: party.id,
          flagId: party.flagId,
          position: party.getPosition(),
        };
      }).filter(party => !!party)
    };

    trace.log("defense memory", {memory: (Memory as any).defense});
  }

  private requestDefenders(trace, kernel: Kernel, hostilesByColony: HostilesByColony) {
    // Check intra-colony requests for defenders
    _.forEach(hostilesByColony, (hostiles, baseId) => {
      const base = kingdom.planner.getBaseById(baseId);
      if (!base) {
        trace.error("cannot find base config", {baseId});
        return;
      }

      const request = kingdom.getNextRequest(getBaseDefenseTopic(base.id));
      if (request) {
        trace.log('got defender request', {request});
        this.handleDefenderRequest(kingdom, base, request, trace);
      }
    });
  }

  private handleDefenderRequest(kernel: Kernel, base: Base, request, trace) {
    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error("cannot find primary room", {base});
      return;
    }

    trace.log('request details', {
      controllerLevel: room?.controller || null,
      request,
    });

    if (request.details.spawn) {
      const spawnRequest = createSpawnRequest(request.priority, request.ttl, request.details.role,
        request.details.memory, 0)
      trace.log('requesting spawning of defenders', {request});
      requestSpawn(kingdom, getBaseSpawnTopic(base.id), spawnRequest);
      // @CONFIRM that defenders spawn
    }

    trace.info('requesting existing defense response', {request});

    // TODO replace with base defense topic
    // Order existing defenders to the room
    kingdom.creepManager.getCreepsByBaseAndRole(base.id, CREEPS.WORKER_DEFENDER).forEach((defender) => {
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
    });
  }
}

type HostilesByColony = Record<string, Target[]>;

function getHostilesByColony(kernel: Kernel, rooms: Room[], trace: Tracer): HostilesByColony {
  return rooms.reduce<HostilesByColony>((colonies, room: Room) => {
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
      const isFriendly = kingdom.config.friends.indexOf(hostile.owner.username) > -1;
      if (isFriendly) {
        const hostilePart = _.find(hostile.body, (part): boolean => {
          // If hostile has work part and near wall/rampart then view as hostile
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

type DefendersByColony = Record<string, (Creep)[]>

function getDefendersByColony(kernel: Kernel, rooms: Room[], trace: Tracer): DefendersByColony {
  return rooms.reduce<DefendersByColony>((colonies, room: Room) => {
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
        const role = creep.memory[MEMORY.MEMORY_ROLE];
        return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
          role === CREEPS.WORKER_DEFENDER_BOOSTED;
      }
    });
    if (defenders.length) {
      colonies[orgColony.id] = colonies[orgColony.id].concat(...defenders);
    }

    return colonies;
  }, {});
}

function addHostilesToColonyTargetTopic(kernel: Kernel, hostilesByColony: Record<string, Target[]>,
  trace: Tracer) {
  // Add targets to colony target topic
  _.forEach(hostilesByColony, (hostiles, colonyId) => {
    const orgColony = kingdom.getColonyById(colonyId);
    if (!orgColony) {
      trace.log('expect to find colony, but did not', {colonyId});
      return;
    }

    hostiles.forEach((hostile) => {
      let healingPower = scoreHealing(hostile as Creep, true);

      // Get adjacent creeps
      const adjacentCreeps = hostile.pos.findInRange(FIND_HOSTILE_CREEPS, 1);

      // Sum up total healing (healing of target + healing of adjacent creeps)
      healingPower = adjacentCreeps.reduce((total, creep) => {
        return total + scoreHealing(creep, true);
      }, healingPower);

      const details = {
        id: hostile.id,
        roomName: hostile.room.name,
        healingPower: healingPower,
      };

      trace.log('requesting target', {details, healingPower});

      orgColony.sendRequest(getBasePriorityTargetsTopic(colonyId), healingPower, details, TARGET_REQUEST_TTL);
    });
  });
}

function publishDefenseStatuses(kernel: Kernel, hostilesByColony: HostilesByColony, trace) {
  kingdom.planner.getBaseList().forEach((base) => {
    const numHostiles = (hostilesByColony[base.id] || []).length;
    const numDefenders = Object.values<Creep>(kingdom.creepManager.getCreepsByBase(base.id)).filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    }).length;

    let status = DEFENSE_STATUS.GREEN;
    if (numHostiles && numDefenders) {
      status = DEFENSE_STATUS.YELLOW;
    } else if (numHostiles) {
      status = DEFENSE_STATUS.RED;
    }

    const details = {
      baseId: base.id,
      status,
      numHostiles,
      numDefenders,
    };

    trace.log('defense status update', details);

    kingdom.sendRequest(TOPICS.DEFENSE_STATUSES, 0, details, DEFENSE_STATUS_TTL)
  });
}

// TODO move into base defense runnable
function checkColonyDefenses(trace: Tracer, kernel: Kernel, hostilesByColony: Record<string, Creep[]>) {
  // Check for defenders
  _.forEach(hostilesByColony, (hostiles, baseId) => {
    const base = kingdom.getPlanner().getBaseById(baseId);
    if (!base) {
      trace.error('expect to find base, but did not', {colonyId: baseId});
      return;
    }

    const defenders = kingdom.creepManager.getCreepsByBase(base.id).filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    });

    trace.log('colony threat status', {colonyId: baseId, numHostiles: hostiles.length, numDefenders: defenders.length});

    if (hostiles.length) {
      requestExistingDefenders(defenders, hostiles[0].pos);

      const hostileScore = hostiles.reduce((acc, hostile) => {
        return acc + scoreHostile(hostile);
      }, 0);
      const defenderScore = defenders.reduce((acc, defender) => {
        return acc + scoreDefender(defender);
      }, 0);

      // are hostiles not in primary room?
      const hostilesNotInPrimaryRoom = hostiles.filter((hostile) => {
        return hostile.room.name !== base.primary;
      });

      let numNeededDefenders = 0;
      if (hostilesNotInPrimaryRoom.length) {
        numNeededDefenders = hostilesNotInPrimaryRoom.length;
      } else {
        // Spawn 2 more defenders if defender score less than hostile score
        if (hostileScore > 100 && hostileScore > defenderScore) {
          numNeededDefenders = defenders.length + 1;
        }
      }

      trace.log('hostiles present', {
        hostileScore,
        defenderScore,
        numNeededDefenders,
        hostilesNotInPrimaryRoom: hostilesNotInPrimaryRoom.length,
        hostiles: hostiles.map((hostile) => {
          return {id: hostile.id, roomName: hostile.room.name};
        }),
        defenders: defenders.map((defender) => {
          return {id: defender.id, roomName: defender.room.name};
        }),
      });

      if (defenders.length < numNeededDefenders) {
        requestAdditionalDefenders(kingdom, base, hostiles.length - defenders.length,
          hostiles[0].pos, trace);
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

function requestAdditionalDefenders(kernel: Kernel, base: Base, needed: number,
  position: RoomPosition, trace: Tracer) {
  const positionStr = [position.x, position.y, position.roomName].join(',');

  for (let i = 0; i < needed; i++) {
    trace.info('requesting defender', {baseId: base.id});

    kingdom.sendRequest(getBaseDefenseTopic(base.id), PRIORITIES.PRIORITY_DEFENDER, {
      role: CREEPS.WORKER_DEFENDER,
      spawn: true,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: position.roomName,
        [MEMORY.MEMORY_ASSIGN_ROOM_POS]: positionStr,
        [MEMORY.MEMORY_BASE]: base.id,
      }
    }, REQUEST_DEFENDERS_TTL);
  }
}

function returnDefendersToStation(trace: Tracer, kernel: Kernel, hostilesByColony: Record<string, Creep[]>) {
  const flags = Object.values(Game.flags).filter((flag) => {
    trace.log('flag', {flag})
    if (!flag.name.startsWith('station') && !flag.name.startsWith('defenders')) {
      return false;
    }

    return kingdom.getRoomColony(flag.pos.roomName);
  });

  trace.log('station/defense flags', {flags});

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

    const defenders = kingdom.creepManager.getCreepsByBase(colony.id).filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    });

    trace.log('sending defenders back to station', {colonyId: colony.id, flagName: flag.name});
    requestExistingDefenders(defenders, flag.pos);
  });
}

function updateDefenseStats(trace: Tracer, kernel: Kernel, hostilesByColony: Record<string, Target[]>) {
  const defendersByColony = getDefendersByColony(kingdom, Object.values(Game.rooms), trace)
  trace.log('defenders by colony', {defendersByColony});

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

// Deprecated, use scoreAttacking
export function scoreHostile(hostile: Creep): number {
  if (!hostile.body) {
    return 0;
  }

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

// Deprecated use scoreHealing
export function scoreDefender(defender: Creep): number {
  if (!defender.body) {
    return 0;
  }

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
