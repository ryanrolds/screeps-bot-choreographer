/**
 * Managers War Parties, including the creation and recreation on startup.
 *
 *
 */

import {Base} from './base';
import {creepIsFresh} from './behavior.commute';
import {AttackStatus, Phase} from './constants.attack';
import * as CREEPS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TOPICS from './constants.topics';
import {Kernel, KernelThreadFunc, threadKernel} from './kernel';
import {buildAttacker, newMultipliers} from './lib.attacker_builder';
import {scoreRoomDamage, scoreStorageHealing} from './lib.scoring';
import {Tracer} from './lib.tracing';
import {Process, sleeping} from './os.process';
import {RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from './os.scheduler';
import {MEMORY_HARASS_BASE, ROLE_HARASSER} from './role.harasser';
import {createSpawnRequest, getBaseSpawnTopic, getShardSpawnTopic} from './runnable.base_spawning';
import {RoomEntry} from './runnable.scribe';
import WarPartyRunnable, {WarParty} from './runnable.warparty';

const WAR_PARTY_RUN_TTL = 100;
const BASE_ATTACK_RANGE = 3;
const MAX_BASES_PER_TARGET = 3;
const MAX_WAR_PARTIES_PER_BASE = 1;
const MAX_HARASSERS_PER_BASE = 1;
const CONSUME_EVENTS_TTL = 20;
const RUN_TTL = 10;

type AttackRequest = {
  status: AttackStatus,
  roomId: string,
}

// interface WarMemory {
//   targetRoom: string;
//   hostileStrength: HostileStrength;
//   parties: WarParty[];
// }

// enum HostileStrength {
//   None = 'none',
//   Weak = 'weak',
//   Medium = 'medium',
//   Strong = 'strong',
// }

export function createAttackRequest(status: AttackStatus, roomId: string): AttackRequest {
  return {status, roomId};
}

export default class WarManager {
  id: string;
  scheduler: Scheduler;
  warParties: WarParty[];

  // TODO make a target struct
  targets: string[] = [];

  updateWarPartiesThread: KernelThreadFunc;
  consumeEventsThread: KernelThreadFunc;
  mapUpdateThread: KernelThreadFunc;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.warParties = null;
    this.targets = [];

    this.consumeEventsThread = threadKernel('events_thread', CONSUME_EVENTS_TTL)(this.consumeEvents.bind(this));
    this.updateWarPartiesThread = threadKernel('update_warparties', WAR_PARTY_RUN_TTL)(this.updateWarParties.bind(this));
    this.mapUpdateThread = threadKernel('map_thread', 1)(this.mapUpdate.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('war_manager_run');

    if (this.warParties === null) {
      trace.info('restoring war parites');
      this.restoreFromMemory(kernel, trace);
    }

    this.updateWarPartiesThread(trace, kernel);
    this.consumeEventsThread(trace, kernel);
    this.mapUpdateThread(trace, kernel);

    // Write post event status
    trace.info('war manager state', {
      targets: this.targets,
      warPartyIds: this.warParties.map((warParty) => warParty.id),
      autoAttack: kernel.getConfig().autoAttack,
    });

    trace.end();

    return sleeping(RUN_TTL);
  }

  consumeEvents(trace: Tracer, kernel: Kernel) {
    // Process events
    let targets = this.targets;

    const topic = kernel.getTopics().getTopic(TOPICS.ATTACK_ROOM);
    if (!topic) {
      trace.warn('no attack room topic');
      return;
    }

    trace.info('consuming events', {length: topic.length});
    let event = null;
    // eslint-disable-next-line no-cond-assign
    while (event = topic.shift()) {
      switch (event.details.status) {
        case AttackStatus.REQUESTED:
          trace.info('requested attack', {target: event.details.roomId});

          if (targets.indexOf(event.details.roomId) === -1) {
            targets.push(event.details.roomId);
          }

          break;
        case AttackStatus.COMPLETED:
          trace.info('attack completed', {roomId: event.details.roomId});

          // clear target room so we don't try to pick it before it's journal entry is updated
          kernel.getScribe().clearRoom(event.details.roomId);

          // remove room from targets when completed
          targets = targets.filter((target) => target !== event.details.roomId);
          break;
        default:
          throw new Error(`invalid status ${event.details.status}`);
      }
    }

    // address bug with duplicate entries
    targets = _.uniq(targets);

    let bases = kernel.getPlanner().getBases();
    // DISABLED so that early game fights can happen - 08/05/2018
    // bases = _.filter(bases, (base) => Game.rooms[base.primary]?.controller.level >= 5);

    trace.info('allowed bases', {bases: bases.map((base) => base.primary)});

    // Sort targets so closest to other bases is prioritized
    targets = _.sortBy(targets, (target) => {
      bases = _.sortBy(bases, (base: Base) => {
        return Game.map.getRoomLinearDistance(base.primary, target);
      });

      if (bases.length === 0) {
        return 999;
      }

      return Game.map.getRoomLinearDistance(bases[0].primary, target);
    });

    trace.notice('targets', {targets});
    this.targets = targets;
  }

  updateWarParties(trace: Tracer, kernel: Kernel) {
    // Update list of war parties
    this.warParties = this.warParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    if (!kernel.getConfig().autoAttack) {
      trace.info('auto attack disabled');
      return;
    }

    if (!this.targets || this.targets.length === 0) {
      trace.info('no target rooms');
      return;
    }

    const bases = kernel.getPlanner().getBases();
    const targetNumBasesAssigned = {};
    const baseAssignments = {};

    this.targets.forEach((target) => {
      const roomEntry = kernel.getScribe().getRoomById(target);
      if (!roomEntry) {
        trace.error('no room entry', {target});
        return;
      }

      if (targetNumBasesAssigned[target] === undefined) {
        targetNumBasesAssigned[target] = 0;
      }

      if (roomEntry.controller) {
        if (roomEntry.controller.safeMode > 150) {
          trace.info('controller is in safe mode', {target});
          return;
        }

        // Send reservers to block if no towers and not in safe mode
        if (roomEntry.numTowers === 0 && roomEntry.controller?.level > 0) {
          trace.info('no towers and still claimed, send reserver', {target});
          this.sendReserver(kernel, target, trace);
        }
      }

      // Determine if we need to send attackers
      if (roomEntry.numTowers > 0 || roomEntry.numKeyStructures > 0) {
        // Locate nearby colonies and spawn war parties
        bases.forEach((base) => {
          // If we have assigned enough rooms, move on
          if (targetNumBasesAssigned[target] >= MAX_BASES_PER_TARGET) {
            return;
          }

          // Check if base already assigned
          if (baseAssignments[base.id]) {
            return;
          }

          const baseTrace = trace.withFields(new Map([['base', base.primary]]));
          // TODO check for path to target
          const linearDistance = Game.map.getRoomLinearDistance(base.primary, target);
          if (linearDistance > BASE_ATTACK_RANGE) {
            baseTrace.info('linear distance too far', {
              base: base.primary, target, linearDistance, BASE_ATTACK_RANGE,
            });
            return;
          }

          const baseRoom = Game.rooms[base.primary];
          if (!baseRoom) {
            baseTrace.warn('no base room', {target, base});
            return;
          }

          trace.info('assigning base', {base: base.primary, target});
          targetNumBasesAssigned[target]++;
          baseAssignments[base.id] = target;

          this.attack(kernel, base, baseRoom, roomEntry, trace);

          return;
        });
      }
    });

    this.writeMemory(trace);
  }

  mapUpdate(trace: Tracer, kernel: Kernel): void {
    if (this.warParties) {
      this.warParties.forEach((party) => {
        const base = kernel.getPlanner().getBaseById(party.baseId);
        if (!base) {
          trace.error('no base', {baseId: party.baseId});
          return;
        }

        Game.map.visual.line(new RoomPosition(25, 25, base.primary), new RoomPosition(25, 25, party.target), {});
      });
    }

    this.targets.forEach((target) => {
      Game.map.visual.text('❌', new RoomPosition(25, 25, target), {
        align: 'center',
        fontSize: 20,
      });
    });
  }

  attack(kernel: Kernel, base: Base, baseRoom: Room, targetRoomEntry: RoomEntry, trace: Tracer) {
    const boosts = newMultipliers();

    const baseStorage = baseRoom.storage;
    if (baseStorage) {
      const availableHealingBoost = scoreStorageHealing(baseStorage);
      boosts[HEAL] = availableHealingBoost;
    }

    const availableEnergyCapacity = baseRoom.energyCapacityAvailable;
    const roomDamage = scoreRoomDamage(targetRoomEntry) / 3;
    const [parts, ok] = buildAttacker(roomDamage, availableEnergyCapacity, boosts, trace);
    if (ok) {
      trace.warn('building attacker', {parts});
      this.sendWarParty(kernel, base, targetRoomEntry, parts, trace);
    } else if (targetRoomEntry.invaderCoreLevel < 1) { // don't harass invaders bases
      // check if an adjacent room has units, if not don't send harasser
      const enemy = targetRoomEntry.controller.owner;
      const adjacentRooms = Game.map.describeExits(targetRoomEntry.id);
      const remote = Object.values(adjacentRooms).find((roomName) => {
        const entry = kernel.getScribe().getRoomById(roomName);
        if (!entry) {
          trace.info('no entry', {roomName});
          return false;
        }

        // make sure room is owned by the target enemy
        if (entry.controller?.owner !== enemy) {
          trace.info('room not owned by enemy', {roomName, enemy, owner: entry.controller?.owner});
          return false;
        }

        // make sure room does not have units that can do significant damage
        if (entry.hostilesDmgByOwner.get(enemy) || 0 > 50) {
          trace.info('room has hostile damage', {roomName, enemy, dmg: entry.hostilesDmgByOwner.get(enemy)});
          return false;
        }

        if (entry.hostilesByOwner.get(enemy) || 0 > 0) {
          trace.info('room has hostile units', {roomName, enemy, hostiles: entry.hostilesByOwner.get(enemy)});
          return false;
        }

        trace.info('room is undefended remote', {roomName, enemy, entry});
        return true;
      });

      if (remote) {
        trace.warn('could not build attacker, harass', {
          base: base.primary,
          targetRoom: targetRoomEntry.id,
          roomDamage, availableEnergyCapacity, boosts,
        });

        this.sendHarassers(kernel, base, targetRoomEntry, trace);
      } else {
        trace.info('no remote rooms to harass', {base: base.primary, targetRoom: targetRoomEntry.id});
      }
    } else {
      trace.warn('could not build attacker, do nothing', {
        base: base.primary,
        targetRoom: targetRoomEntry.id,
        roomDamage, availableEnergyCapacity, boosts,
      });
    }
  }

  sendReserver(kernel: Kernel, target: string, trace: Tracer) {
    const numReservers = _.filter(Game.creeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_RESERVER) &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === target && creepIsFresh(creep);
    }).length;

    if (numReservers < 1) {
      const priority = PRIORITIES.PRIORITY_RESERVER;
      const ttl = WAR_PARTY_RUN_TTL;
      const role = CREEPS.WORKER_RESERVER;
      const memory = {
        [MEMORY.MEMORY_ASSIGN_ROOM]: target,
      };

      const request = createSpawnRequest(priority, ttl, role, memory, null, 0);
      trace.notice('requesting reserver', {request});
      kernel.getTopics().addRequestV2(getShardSpawnTopic(), request);
    } else {
      trace.info('reserver already exists', {numReservers});
    }
  }

  sendHarassers(kernel: Kernel, base: Base, targetRoom: RoomEntry, trace: Tracer) {
    // get number of harassers
    const numHarassers = _.filter(Game.creeps, (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === ROLE_HARASSER &&
        creep.memory[MEMORY.MEMORY_BASE] === base.id &&
        creep.memory[MEMORY_HARASS_BASE] === targetRoom.id &&
        creepIsFresh(creep);
    });


    // if we have too many, don't bother
    if (numHarassers.length >= MAX_HARASSERS_PER_BASE) {
      trace.info('too many harassers', {numHarassers});
      return;
    }

    /*
    if (this.lastHarassTime + HARASS_COOLDOWN < Game.time) {
      trace.info('delaying next harasser', {
        lastHarassTime: this.lastHarassTime,
        cooldown: this.lastHarassTime + HARASS_COOLDOWN - Game.time
      });
      return;
    }
    */

    // request more
    const priorities = PRIORITIES.PRIORITY_HARASSER;
    const ttl = WAR_PARTY_RUN_TTL;
    const role = ROLE_HARASSER;
    const memory = {
      [MEMORY.MEMORY_BASE]: base.id,
      [MEMORY_HARASS_BASE]: targetRoom.id,
    };

    const request = createSpawnRequest(priorities, ttl, role, memory, null, 0);
    trace.notice('requesting harasser', {request});
    kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
  }

  sendWarParty(kernel: Kernel, base: Base, targetRoom: RoomEntry, parts: BodyPartConstant[],
    trace: Tracer) {
    const numBaseWarParties = this.warParties.filter((party) => {
      return party.baseId === base.id;
    }).length;
    if (numBaseWarParties >= MAX_WAR_PARTIES_PER_BASE) {
      trace.info('too many war parties', {numBaseWarParties});
      return;
    }

    trace.info('base parties', {
      baseId: base.id,
      numBaseWarParties,
      max: MAX_WAR_PARTIES_PER_BASE,
    });

    const flagId = `rally_${base.primary}`;
    const flag = Game.flags[flagId];
    if (!flag) {
      trace.warn(`not creating war party, no rally flag(${flagId})`);
      return null;
    }

    const partyId = `war_party_${targetRoom.id}_${base.primary}_${Game.time}`;
    trace.info('creating war party', {target: targetRoom.id, partyId, flagId});

    const warPartyRunnable = this.createAndScheduleWarParty(base, partyId, targetRoom.id,
      Phase.PHASE_MARSHAL, flag.pos, flag.name, CREEPS.WORKER_ATTACKER, trace);

    if (warPartyRunnable) {
      this.warParties.push(warPartyRunnable.toWarParty());
    }
  }

  createAndScheduleWarParty(base: Base, id: string, target: string, phase: Phase,
    position: RoomPosition, flagId: string, role: string, _trace: Tracer): WarPartyRunnable {
    const party = new WarPartyRunnable(id, base.id, flagId, position, target, role, phase);
    const process = new Process(id, 'war_party', Priorities.OFFENSE, party);
    process.setSkippable(false);
    this.scheduler.registerProcess(process);

    return party;
  }

  private writeMemory(_trace: Tracer) {
    // Update memory
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Memory as any).war = {
      targets: this.targets,
      parties: this.warParties,
    };
  }

  private restoreFromMemory(kernel: Kernel, trace: Tracer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const memory = (Memory as any);

    trace.info('restore memory', {war: memory.war || null});

    // If there is no memory, setup defaults
    if (!memory.war) {
      memory.war = {
        targets: [],
        parties: [],
      };
    }

    this.targets = memory.war.targets || [];
    this.warParties = memory.war.parties.map((party: WarParty) => {
      trace.info('restoring party', {party});

      if (!party.id || !party.target || !party.phase || !party.position || !party.baseId ||
        !party.flagId || !party.role) {
        trace.error('invalid party', {party});
        return null;
      }

      const position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      const base = kernel.getPlanner().getBaseById(party.baseId);
      if (!base) {
        trace.warn('not create war party, cannot find base config', {baseId: party.baseId});
        return null;
      }

      return this.createAndScheduleWarParty(base, party.id, party.target, party.phase,
        position, party.flagId, party.role, trace);
    }).filter((party) => {
      return party;
    });

    trace.info('restore complete', {
      targets: this.targets,
      warParties: this.warParties.map((warParty) => warParty.id),
    });
  }
}
