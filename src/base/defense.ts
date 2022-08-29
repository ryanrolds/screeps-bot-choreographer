/**
 * Base Defense Manager
 * Created: August 2022
 *
 * - Scan remotes for hostiles, if found set yellow alert and dispatch ranged defenders to room
 * - Scan primary room for hostiles, if found set red alert and dispatch melee defenders to ramparts
 * - Report base defense status to stream
 *
 * Base defense: 2 melee defenders that position themselves where enemy is trying to punch through.
 * create additional ranged defenders to the break through point.
 *
 * Room defense: Send enough defenders (singles or quads) to kill the hostiles. Frequently invaders.
 *
 * TODO: Request base defenders from neighbors
 */
import * as _ from 'lodash';
import * as CREEPS from '../constants/creeps';
import {DEFENSE_STATUS} from '../constants/defense';
import * as MEMORY from '../constants/memory';
import {PRIORITY_DEFENDER} from '../constants/priorities';
import * as TOPICS from '../constants/topics';
import {creepIsFresh} from '../creeps/behavior/commute';
import {newMultipliers} from '../creeps/builders/attacker';
import {buildDefender} from '../creeps/builders/defender';
import DefensePartyRunnable from '../creeps/party/defense';
import {scoreHealing} from '../creeps/roles/harasser';
import {Request} from '../lib/topics';
import {Tracer} from '../lib/tracing';
import {Base, getBasePrimaryRoom} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {Process, RunnableResult, sleeping, terminate} from '../os/process';
import {Priorities, Scheduler} from '../os/scheduler';
import {createSpawnRequest, getBaseSpawnTopic, SpawnRequestDetails} from './spawning';

const RUN_INTERVAL = 5;
const TARGET_REQUEST_TTL = RUN_INTERVAL;
const DEFENSE_STATUS_TTL = RUN_INTERVAL;
const REQUEST_DEFENDERS_TTL = 25;
// const REQUEST_DEFENDER_TTL = 5;
const MAX_DEFENDERS_PER_ROOM = 1;

export function getBasePriorityTargetsTopic(baseId: string): string {
  return `base_${baseId}_priority_targets`;
}

export function getBasePriorityHealsTopic(baseId: string): string {
  return `base_${baseId}_priority_heals`;
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

export type DefenseStatus = {
  baseId: string,
  status: string,
  numHostiles: number,
  numDefenders: number,
}

export type TargetRequest = {
  id: Id<Creep>,
  roomName: string,
  healingPower: number,
  // TODO include rangedAttackPower
  // TODO include meleeAttackPower
}

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
  baseId: string;
  scheduler: Scheduler;
  memory: DefenseMemory;
  defenseParties: DefensePartyRunnable[];

  // Legacy code
  // threadCheckBaseDefenses: KernelThreadFunc;
  // threadReturnDefendersToStation: KernelThreadFunc;
  // threadHandleDefenderRequest: KernelThreadFunc;

  constructor(kernel: Kernel, base: Base, trace: Tracer) {
    this.baseId = base.id;
    this.scheduler = kernel.getScheduler();
    this.restoreFromMemory(kernel, trace);

    //this.threadCheckBaseDefenses = threadKernel('check_defense_thread', REQUEST_DEFENDERS_TTL)(checkBaseDefenses);
    //this.threadReturnDefendersToStation = threadKernel('recall_defenders_thread', REQUEST_DEFENDERS_TTL)(returnDefendersToStation);
    //this.threadHandleDefenderRequest = threadKernel('request_defenders_thread', REQUEST_DEFENDER_TTL)(this.requestDefenders.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('defense_manager_run');
    trace.info('defense manager run');

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('base not found, terminating', {baseId: this.baseId});
      return terminate();
    }

    // Check base for attackers
    this.defendBase(kernel, base, trace);

    // Check remotes for attackers
    this.defendRemotes(kernel, base, trace);

    /* Legacy code
    const defenseStatusTrace = trace.begin('updateDefenseStatus');
    publishDefenseStatuses(kernel, hostilesByBase, defenseStatusTrace);
    defenseStatusTrace.end();

    this.handleDefendFlags(kernel, trace);
    this.threadCheckBaseDefenses(trace, kernel, hostilesByBase);
    this.threadReturnDefendersToStation(trace, kernel, hostilesByBase);
    this.threadHandleDefenderRequest(trace, kernel, hostilesByBase);
    */

    trace.end();

    return sleeping(RUN_INTERVAL);
  }

  private restoreFromMemory(kernel: Kernel, trace: Tracer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  defendBase(kernel: Kernel, base: Base, trace: Tracer) {
    // Ensure that towers have something to shoot at
    const targetTopicTrace = trace.begin('addHostilesToBaseTargetTopic');
    addHostilesToBaseTargetTopic(kernel, base, targetTopicTrace);
    targetTopicTrace.end();
  }

  defendRemotes(kernel: Kernel, base: Base, trace: Tracer) {
    const roomsNeedingDefenders: Map<string, number> = new Map();

    const hostileAttackPowerByRoom = getHostileAttackPowerByBaseRoom(kernel, base, trace);
    trace.info('hostile attack power by room', {
      baseId: this.baseId,
      rooms: Array.from(hostileAttackPowerByRoom.entries())
    });

    // check if hostiles in primary room
    const primaryRoomHostiles = hostileAttackPowerByRoom.get(base.primary);
    if (primaryRoomHostiles > 0) {
      // request rampart defense and regular defenders
      trace.warn('hostiles in primary room', {baseId: this.baseId, primaryRoomHostiles});

      // const memory = {
      //   [MEMORY.MEMORY_ASSIGN_ROOM]: base.primary,
      //   [MEMORY.MEMORY_BASE]: base.id,
      // };
      // const request = createSpawnRequest(PRIORITY_RAMPART_DEFENDER, REQUEST_DEFENDERS_TTL + Game.time,
      //   CREEPS.WORKER_DEFENDER, memory, null, 0);
      // trace.warn('requesting rampaert defenders', {roomName: base.primary, primaryRoomHostiles});
      // kernel.getTopics().addRequestV2(getBaseDefenseTopic(base.id), request);
    }

    for (const [roomName, attackPower] of hostileAttackPowerByRoom) {
      // if no hostiles, dont send defenders
      if (attackPower == 0) {
        continue;
      }

      // Don't send defenders to primary room
      if (roomName === base.primary) {
        continue;
      }

      // Request defenders from base
      trace.warn('requesting defenders', {roomName, attackPower});
    }

    // Check rooms for Invader Cores
    base.rooms.forEach((roomName) => {
      const roomEntry = kernel.getScribe().getRoomById(roomName);
      if (!roomEntry) {
        trace.warn('checking for invader cores, room entry not found', {roomName});
        return;
      }

      if (roomEntry.invaderCorePos && roomEntry.invaderCoreLevel === 0) {
        trace.warn('checking for invader cores, invader core found', {roomName});

        let hostileAttackPower = roomsNeedingDefenders.get(roomName) || -1;
        if (hostileAttackPower < 0) {
          hostileAttackPower = 0;
        }

        roomsNeedingDefenders.set(roomName, hostileAttackPower);
      }
    });

    const defenders = kernel.getCreepsManager().getCreepsByBaseAndRole(this.baseId, CREEPS.WORKER_DEFENDER)

    // Handle defense needs
    for (const [roomName, attackPower] of roomsNeedingDefenders) {
      // Primary room also needs rampart defense
      // Check if rampart defenders exist
      // if not, build parts list and request spawning of rampart defenders

      // Check if defenders already exist (regular rooms and primary)
      const roomDefenders = defenders.filter((creep) => {
        return creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === roomName;
      });
      if (roomDefenders.length > MAX_DEFENDERS_PER_ROOM) {
        trace.warn('defenders already exist', {roomName, roomDefenders});
        continue;
      }

      const primaryRoom = Game.rooms[base.primary];
      if (!primaryRoom) {
        trace.warn('primary room not found', {baseId: this.baseId, primaryRoom});
        continue;
      }

      // Build parts list and request spawning of defenders
      const multipliers = newMultipliers();
      const [parts, ok] = buildDefender(attackPower, primaryRoom.energyCapacityAvailable,
        multipliers, trace);
      if (!ok) {
        trace.warn('defender build failed, we cannot take the room', {
          roomName, attackPower,
          energyCapacityAvailable: primaryRoom.energyCapacityAvailable
        });
        continue;
      }

      const memory = {
        [MEMORY.MEMORY_ASSIGN_ROOM]: roomName,
        [MEMORY.MEMORY_BASE]: base.id,
      };
      const request = createSpawnRequest(PRIORITY_DEFENDER, REQUEST_DEFENDERS_TTL + Game.time,
        CREEPS.WORKER_DEFENDER, memory, parts, 0);
      trace.warn('requesting defenders', {roomName, attackPower, request});
      kernel.getTopics().addRequestV2(getBaseDefenseTopic(base.id), request);
    }
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

    trace.notice('creating defense party', {id, position, flagId, baseId: base.id});

    const party = new DefensePartyRunnable(id, base, flagId, position);
    const process = new Process(id, 'defense_party', Priorities.DEFENCE, {
      run(kernel: Kernel, trace: Tracer): RunnableResult {
        return party.run(kernel, trace);
      },
    });
    this.scheduler.registerProcess(process);

    return party;
  }

  private handleDefendFlags(kernel: Kernel, trace: Tracer) {
    // Removed old defense parties
    this.defenseParties = this.defenseParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    Object.values(Game.flags).forEach((flag) => {
      if (flag.name.startsWith('defend_')) {
        const flagDefensePartyId = `${flag.name}_party`;
        trace.info('defend flag', {flagDefensePartyId});
        if (!this.scheduler.hasProcess(flagDefensePartyId)) {
          const party = this.createAndScheduleDefenseParty(kernel, flagDefensePartyId, flag.name, flag.pos, trace);
          this.defenseParties.push(party);
        }
      }
    });

    // Update memory
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trace.info('defense memory', {memory: (Memory as any).defense});
  }

  private requestDefenders(trace, kernel: Kernel, hostilesByBase: HostilesByBase) {
    // Check intra-base requests for defenders
    Array.from(hostilesByBase.keys()).forEach((baseId) => {
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
        request.details.memory, null, 0);
      trace.log('requesting spawning of defenders', {request});
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), spawnRequest);
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

function _getHostilesByBase(kernel: Kernel, trace: Tracer): HostilesByBase {
  return Object.values(Game.rooms).reduce<HostilesByBase>((bases, room: Room) => {
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
          trace.info('non-hostile creep', {creepName: hostile.name, owner: hostile.owner.username});
          return false;
        }
      }

      trace.info('hostile creep', {creepName: hostile.name, owner: hostile.owner.username});

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
  }, new Map());
}

// function addHealTargetsToBaseTopic(kernal: Kernel, damagedCreeps) {

// }

function addHostilesToBaseTargetTopic(kernel: Kernel, base: Base, trace: Tracer) {
  // Add targets to base target topic
  const primaryRoom = getBasePrimaryRoom(base);
  if (!primaryRoom) {
    trace.error('cannot find primary room', {base});
    return;
  }

  const hostiles = primaryRoom.find(FIND_HOSTILE_CREEPS);
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
      // TODO include rangedAttackPower
      // TODO include meleeAttackPower
    };

    const request: Request<TargetRequest> = {
      priority: healingPower,
      ttl: TARGET_REQUEST_TTL + Game.time,
      details,
    };

    trace.info('requesting target', {details, healingPower});
    kernel.getTopics().addRequestV2(getBasePriorityTargetsTopic(base.id), request);
  });

  /*
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
        // TODO include rangedAttackPower
        // TODO include meleeAttackPower
      };

      trace.info('requesting target', {details, healingPower});

      kernel.getTopics().addRequest(getBasePriorityTargetsTopic(baseId), healingPower,
        details, TARGET_REQUEST_TTL + Game.time);
    });
  });
  */
}

function _publishDefenseStatuses(kernel: Kernel, hostilesByBase: HostilesByBase, trace) {
  kernel.getPlanner().getBases().forEach((base) => {
    const numHostiles = (hostilesByBase.get(base.id) || []).length;
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

    const request: Request<DefenseStatus> = {
      priority: 0,
      ttl: DEFENSE_STATUS_TTL + Game.time,
      details,
    }

    trace.log('defense status update', details);
    kernel.getTopics().addRequestV2(TOPICS.DEFENSE_STATUSES, request);
  });
}

function _checkBaseDefenses(trace: Tracer, kernel: Kernel, hostilesByBase: Map<string, Creep[]>) {
  // Check for defenders
  Array.from(hostilesByBase.entries()).forEach(([baseId, hostiles]) => {
    const base = kernel.getPlanner().getBaseById(baseId);
    if (!base) {
      trace.error('expect to find base, but did not', {baseId: baseId});
      return;
    }

    const defenders = kernel.getCreepsManager().getCreepsByBase(base.id).filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED) && creepIsFresh(creep);
    });

    trace.info('base threat status', {
      baseId: baseId, numHostiles: hostiles.length,
      numDefenders: defenders.length
    });

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

      trace.info('hostiles present', {
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

    const details: SpawnRequestDetails = {
      role: CREEPS.WORKER_DEFENDER,
      memory: {
        [MEMORY.MEMORY_ASSIGN_ROOM]: position.roomName,
        [MEMORY.MEMORY_ASSIGN_ROOM_POS]: positionStr,
        [MEMORY.MEMORY_BASE]: base.id,
      },
    }

    const request: Request<SpawnRequestDetails> = {
      priority: PRIORITY_DEFENDER,
      ttl: REQUEST_DEFENDERS_TTL + Game.time,
      details,
    };

    kernel.getTopics().addRequestV2(getBaseDefenseTopic(base.id), request);
  }
}

function _returnDefendersToStation(trace: Tracer, kernel: Kernel, hostilesByBase: Map<string, Creep[]>) {
  const flags = Object.values(Game.flags).filter((flag) => {
    trace.info('flag', {flag});
    if (!flag.name.startsWith('station') && !flag.name.startsWith('defenders')) {
      return false;
    }

    return kernel.getPlanner().getBaseByRoom(flag.pos.roomName);
  });

  trace.info('station/defense flags', {flags});

  flags.forEach((flag) => {
    const base = kernel.getPlanner().getBaseByRoom(flag.pos.roomName);
    if (!base) {
      trace.info('cannot find base for room', {roomName: flag.pos.roomName});
      return;
    }

    if (hostilesByBase.get(base.id) && hostilesByBase.get(base.id).length) {
      trace.info('hostiles present, not returning defenders');
      return;
    }

    const defenders = kernel.getCreepsManager().getCreepsByBase(base.id).filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === CREEPS.WORKER_DEFENDER || role === CREEPS.WORKER_DEFENDER_DRONE ||
        role === CREEPS.WORKER_DEFENDER_BOOSTED;
    });

    trace.info('sending defenders back to station', {baseId: base.id, flagName: flag.name});
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

function getHostileAttackPowerByBaseRoom(kernel: Kernel, base: Base, _trace: Tracer): Map<string, number> {
  const hostileAttackPowerByRoom = new Map<string, number>();

  base.rooms.forEach((roomName) => {
    const roomEntry = kernel.getScribe().getRoomById(roomName);
    if (!roomEntry) {
      return;
    }

    hostileAttackPowerByRoom.set(roomName, roomEntry.hostilesDmg);
  });

  return hostileAttackPowerByRoom;
}
