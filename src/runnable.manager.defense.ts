import * as _ from 'lodash';
import {Base, getBasePrimaryRoom} from './base';
import * as CREEPS from './constants.creeps';
import {DEFENSE_STATUS} from './constants.defense';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TOPICS from './constants.topics';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {Process, sleeping} from './os.process';
import {RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from './os.scheduler';
import {thread, ThreadFunc} from './os.thread';
import {scoreHealing} from './role.harasser';
import {createSpawnRequest, getBaseSpawnTopic} from './runnable.base_spawning';
import DefensePartyRunnable from './runnable.defense_party';

const RUN_INTERVAL = 5;
const TARGET_REQUEST_TTL = RUN_INTERVAL;
const DEFENSE_STATUS_TTL = RUN_INTERVAL;
const REQUEST_DEFENDERS_TTL = 25;
const UPDATE_DEFENSE_STATS_TTL = 5;
const REQUEST_DEFENDER_TTL = 5;

export function getBasePriorityTargetsTopic(baseId: string): string {
  return `base_${baseId}_priority_targets`;
}

export function getBaseDefenseTopic(baseId: string): string {
  return `base_${baseId}_defense`;
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
  threadHandleDefenderRequest: ThreadFunc;

  constructor(kernel: Kernel, id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.restoreFromMemory(kernel, trace);

    this.threadCheckColonyDefenses = thread('check_defense_thread', REQUEST_DEFENDERS_TTL)(checkColonyDefenses);
    this.threadReturnDefendersToStation = thread('recall_defenders_thread', REQUEST_DEFENDERS_TTL)(returnDefendersToStation);
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
        trace.error('invalid defense party', {party});
        return null;
      }

      party.position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      return this.createAndScheduleDefenseParty(kernel, party.id, party.flagId, party.position, trace);
    }).filter((party) => {
      return !!party;
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
    const base = kernel.getPlanner().getClosestBaseInRange(flag.pos.roomName, 5);
    if (!base) {
      trace.error('could not find base in range, not creating defense party', {roomName: flag.pos.roomName});
      return;
    }

    trace.notice('creating defense party', {id, position, flagId, colonyId: base.id});

    const party = new DefensePartyRunnable(id, base, flagId, position, trace);
    const process = new Process(id, 'defense_party', Priorities.DEFENCE, {
      run(kernel: Kernel, trace: Tracer): RunnableResult {
        return party.run(kernel, trace);
      },
    });
    this.scheduler.registerProcess(process);

    return party;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('defense_manager_run');
    trace.log('defense manager run');

    const hostilesTrace = trace.begin('getHostilesByColony');
    const hostilesByColony = getHostilesByColony(kernel, Object.values(Game.rooms), hostilesTrace);
    hostilesTrace.log('hostiles by colony', {hostilesByColony});
    hostilesTrace.end();

    const targetTopicTrace = trace.begin('addHostilesToColonyTargetTopic');
    addHostilesToColonyTargetTopic(kernel, hostilesByColony, targetTopicTrace);
    targetTopicTrace.end();

    const defenseStatusTrace = trace.begin('updateDefenseStatus');
    publishDefenseStatuses(kernel, hostilesByColony, defenseStatusTrace);
    defenseStatusTrace.end();

    this.handleDefendFlags(kernel, trace);
    this.threadCheckColonyDefenses(trace, kernel, hostilesByColony);
    this.threadReturnDefendersToStation(trace, kernel, hostilesByColony);
    this.threadHandleDefenderRequest(trace, kernel, hostilesByColony);

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
        trace.log('defend flag', {flagDefensePartyId});
        if (!this.scheduler.hasProcess(flagDefensePartyId)) {
          const party = this.createAndScheduleDefenseParty(kernel, flagDefensePartyId, flag.name, flag.pos, trace);
          this.defenseParties.push(party);
        }
      }
    });

    // Update memory
    (Memory as any).defense = {
      parties: this.defenseParties.map((party): StoredDefenseParty => {
        if (!Game.flags[party.flagId]) {
          trace.error('missing flag', {flagId: party.flagId});
          return null;
        }

        return {
          id: party.id,
          flagId: party.flagId,
          position: party.getPosition(),
        };
      }).filter((party) => !!party),
    };

    trace.log('defense memory', {memory: (Memory as any).defense});
  }

  private requestDefenders(trace, kernel: Kernel, hostilesByColony: HostilesByBase) {
    // Check intra-colony requests for defenders
    Array.from(hostilesByColony.keys()).forEach((baseId) => {
      const base = kernel.getPlanner().getBaseById(baseId);
      if (!base) {
        trace.error('cannot find base config', {baseId});
        return;
      }

      const request = kernel.getTopics().getNextRequest(getBaseDefenseTopic(base.id));
      if (request) {
        trace.log('got defender request', {request});
        this.handleDefenderRequest(kernel, base, request, trace);
      }
    });
  }

  private handleDefenderRequest(kernel: Kernel, base: Base, request, trace) {
    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error('cannot find primary room', {base});
      return;
    }

    trace.log('request details', {
      controllerLevel: room?.controller || null,
      request,
    });

    if (request.details.spawn) {
      const spawnRequest = createSpawnRequest(request.priority, request.ttl, request.details.role,
        request.details.memory, 0);
      trace.log('requesting spawning of defenders', {request});
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), spawnRequest);
      // @CONFIRM that defenders spawn
    }

    trace.info('requesting existing defense response', {request});

    // TODO replace with base defense topic
    // Order existing defenders to the room
    kernel.getCreepsManager().getCreepsByBaseAndRole(base.id, CREEPS.WORKER_DEFENDER).forEach((defender) => {
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM];
      defender.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS] = request.details.memory[MEMORY.MEMORY_ASSIGN_ROOM_POS];
    });
  }
}

type HostilesByBase = Map<string, Target[]>;

function getHostilesByColony(kernel: Kernel, rooms: Room[], trace: Tracer): HostilesByBase {
  return rooms.reduce<HostilesByBase>((bases, room: Room) => {
    const base = kernel.getPlanner().getBaseByRoom(room.name);
    if (!base) {
      return bases;
    }

    if (!bases.get(base.id)) {
      bases.set(base.id, []);
    }

    // Add any hostiles
    let hostiles = room.find(FIND_HOSTILE_CREEPS);
    hostiles = hostiles.filter((hostile) => {
      const isFriendly = kernel.getFriends().indexOf(hostile.owner.username) > -1;
      if (isFriendly) {
        const hostilePart = _.find(hostile.body, (part): boolean => {
          // If hostile has work part and near wall/rampart then view as hostile
          if (part.type === WORK && hostile.pos.findInRange(FIND_STRUCTURES, 5, {
            filter: (structure) => {
              return structure.structureType === STRUCTURE_RAMPART ||
                structure.structureType === STRUCTURE_WALL;
            },
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
      bases.set(base.id, bases.get(base.id).concat(...hostiles));
    }

    const invaderCores = room.find<StructureInvaderCore>(FIND_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_INVADER_CORE;
      },
    });
    if (invaderCores.length) {
      bases.set(base.id, bases.get(base.id).concat(...invaderCores));
    }

    return bases;
  }, {} as HostilesByBase);
}

type DefendersByBase = Map<string, (Creep)[]>

function getDefendersByColony(kernel: Kernel, rooms: Room[], trace: Tracer): DefendersByBase {
  return rooms.reduce<DefendersByBase>((bases, room: Room) => {
    const base = kernel.getPlanner().getBaseByRoom(room.name);
    if (!base) {
      return bases;
    }

    if (!bases.get(base.id)) {
      bases.set(base.id, []);
    }

    // Add any defenders
    const defenders = room.find(FIND_MY_CREEPS, {
      filter: (creep) => {
        const role = creep.memory[MEMORY.MEMORY_ROLE];
        return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
          role === CREEPS.WORKER_DEFENDER_BOOSTED;
      },
    });
    if (defenders.length) {
      bases.set(base.id, bases.get(base.id).concat(...defenders));
    }

    return bases;
  }, {} as DefendersByBase);
}

function addHostilesToColonyTargetTopic(kernel: Kernel, hostilesByBases: HostilesByBase,
  trace: Tracer) {
  // Add targets to colony target topic
  Array.from(hostilesByBases.entries()).forEach(([baseId, hostiles]) => {
    const base = kernel.getPlanner().getBaseById(baseId);
    if (!base) {
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

      kernel.getTopics().addRequest(getBasePriorityTargetsTopic(baseId), healingPower, details, TARGET_REQUEST_TTL);
    });
  });
}

function publishDefenseStatuses(kernel: Kernel, hostilesByColony: HostilesByBase, trace) {
  kernel.getPlanner().getBases().forEach((base) => {
    const numHostiles = (hostilesByColony.get(base.id) || []).length;
    const numDefenders = Object.values<Creep>(kernel.getCreepsManager().
      getCreepsByBase(base.id)).filter((creep) => {
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

    kernel.getTopics().addRequest(TOPICS.DEFENSE_STATUSES, 0, details, DEFENSE_STATUS_TTL);
  });
}

// TODO move into base defense runnable
function checkColonyDefenses(trace: Tracer, kernel: Kernel, hostilesByColony: Map<string, Creep[]>) {
  // Check for defenders
  Array.from(hostilesByColony.entries()).forEach(([baseId, hostiles]) => {
    const base = kernel.getPlanner().getBaseById(baseId);
    if (!base) {
      trace.error('expect to find base, but did not', {colonyId: baseId});
      return;
    }

    const defenders = kernel.getCreepsManager().getCreepsByBase(base.id).filter((creep) => {
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
        requestAdditionalDefenders(kernel, base, hostiles.length - defenders.length,
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

    kernel.getTopics().addRequest(getBaseDefenseTopic(base.id), PRIORITIES.PRIORITY_DEFENDER, {
      role: CREEPS.WORKER_DEFENDER,
      spawn: true,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: position.roomName,
        [MEMORY.MEMORY_ASSIGN_ROOM_POS]: positionStr,
        [MEMORY.MEMORY_BASE]: base.id,
      },
    }, REQUEST_DEFENDERS_TTL);
  }
}

function returnDefendersToStation(trace: Tracer, kernel: Kernel, hostilesByColony: Map<string, Creep[]>) {
  const flags = Object.values(Game.flags).filter((flag) => {
    trace.log('flag', {flag});
    if (!flag.name.startsWith('station') && !flag.name.startsWith('defenders')) {
      return false;
    }

    return kernel.getPlanner().getBaseByRoom(flag.pos.roomName);
  });

  trace.log('station/defense flags', {flags});

  flags.forEach((flag) => {
    const base = kernel.getPlanner().getBaseByRoom(flag.pos.roomName);
    if (!base) {
      trace.log('cannot find colony for room', {roomName: flag.pos.roomName});
      return;
    }

    if (hostilesByColony.get(base.id) && hostilesByColony.get(base.id).length) {
      trace.log('hostiles present, not returning defenders');
      return;
    }

    const defenders = kernel.getCreepsManager().getCreepsByBase(base.id).filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    });

    trace.log('sending defenders back to station', {colonyId: base.id, flagName: flag.name});
    requestExistingDefenders(defenders, flag.pos);
  });
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
  }, 0);
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
  }, 0);
}
