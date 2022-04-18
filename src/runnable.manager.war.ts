import {Priorities, Scheduler} from "./os.scheduler";
import {Process, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import WarPartyRunnable from './runnable.warparty';
import * as TOPICS from './constants.topics';
import {AttackStatus, Phase} from './constants.attack';
import * as MEMORY from './constants.memory';
import * as CREEPS from './constants.creeps';
import * as PRIORITIES from './constants.priorities';
import {creepIsFresh} from './behavior.commute';
import {thread, ThreadFunc} from './os.thread';
import {RoomEntry} from './runnable.scribe';
import {BaseConfig} from './config';
import {RunnableResult} from "./os.runnable";
import {getKingdomSpawnTopic} from "./topics.kingdom";
import {buildAttacker, newMultipliers} from "./lib.attacker_builder";
import {MEMORY_HARASS_BASE, ROLE_HARASSER} from "./role.harasser";
import {getBaseSpawnTopic} from "./topics.base";
import {scoreRoomDamage, scoreStorageHealing} from "./lib.scoring";

const WAR_PARTY_RUN_TTL = 50;
const COLONY_ATTACK_RANGE = 3;
const MAX_BASES_PER_TARGET = 3;
const MAX_WAR_PARTIES_PER_COLONY = 1;
const MAX_HARASSERS_PER_BASE = 1;
const HARASS_COOLDOWN = 700;

interface StoredWarParty {
  id: string;
  target: string;
  flagId: string;
  position: RoomPosition;
  colony: string;
  phase: Phase;
  role: string;
  parts: BodyPartConstant[];
}

interface WarMemory {
  targetRoom: string;
  hostileStrength: HostileStrength;
  parties: StoredWarParty[];
}

enum HostileStrength {
  None = 'none',
  Weak = 'weak',
  Medium = 'medium',
  Strong = 'strong',
};

export default class WarManager {
  id: string;
  scheduler: Scheduler;
  memory: WarMemory;
  warParties: WarPartyRunnable[];

  // TODO make a target struct
  targets: string[] = [];

  updateWarPartiesThread: ThreadFunc;
  processEventsThread: ThreadFunc;
  mapUpdateThread: ThreadFunc;

  constructor(kingdom: Kingdom, id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.warParties = null;
    this.targets = [];

    this.processEventsThread = thread('events_thread', WAR_PARTY_RUN_TTL)(this.processEvents.bind(this));
    this.updateWarPartiesThread = thread('update_warparties', WAR_PARTY_RUN_TTL)(this.updateWarParties.bind(this));
    this.mapUpdateThread = thread('map_thread', 1)(this.mapUpdate.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('war_manager_run');

    if (this.warParties === null) {
      trace.info('restoring war parites');
      this.restoreFromMemory(kingdom, trace);
    }

    this.updateWarPartiesThread(trace, kingdom);
    this.processEventsThread(trace, kingdom);
    this.mapUpdateThread(trace);

    // Write post event status
    trace.info("war manager state", {
      targets: this.targets,
      warPartyIds: this.warParties.map(warParty => warParty.id)
    });

    trace.end();

    return sleeping(WAR_PARTY_RUN_TTL);
  }

  processEvents(trace: Tracer, kingdom: Kingdom) {
    // Process events
    let targets = this.targets;

    const topic = kingdom.getTopics().getTopic(TOPICS.ATTACK_ROOM);
    if (!topic) {
      trace.warn("no attack room topic");
      return;
    }

    trace.info("processing events", {length: topic.length});
    let event = null;
    while (event = topic.shift()) {
      switch (event.details.status) {
        case AttackStatus.REQUESTED:
          trace.info("requested attack", {target: event.details.roomId});

          if (targets.indexOf(event.details.roomId) === -1) {
            targets.push(event.details.roomId);
          }

          break;
        case AttackStatus.COMPLETED:
          trace.info('attack completed', {roomId: event.details.roomId});

          // clear target room so we don't try to pick it before it's journal entry is updated
          kingdom.getScribe().clearRoom(event.details.roomId);

          // remove room from targets when completed
          targets = targets.filter(target => target !== event.details.roomId);
          break;
        default:
          throw new Error(`invalid status ${event.details.status}`);
      }
    }

    // address bug with duplicate entries
    targets = _.uniq(targets);

    let bases = kingdom.getPlanner().getBaseConfigs();
    bases = _.filter(bases, base => Game.rooms[base.primary]?.controller.level >= 5);

    trace.log('allowed bases', {bases: bases.map(base => base.primary)});

    // Sort targets so closest to other bases is prioritized
    targets = _.sortBy(targets, target => {
      bases = _.sortBy(bases, (base: BaseConfig) => {
        return Game.map.getRoomLinearDistance(base.primary, target);
      });

      return Game.map.getRoomLinearDistance(bases[0].primary, target);
    });

    trace.notice('targets', {targets});
    this.targets = targets;
  }

  updateWarParties(trace: Tracer, kingdom: Kingdom) {
    // Update list of war parties
    this.warParties = this.warParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });


    if (!this.targets || this.targets.length === 0) {
      trace.info("no target rooms");
      return;
    }

    let bases = kingdom.getPlanner().getBaseConfigs();
    let targetNumBasesAssigned = {};
    let baseAssignments = {};

    this.targets.forEach((target) => {
      const roomEntry = kingdom.getScribe().getRoomById(target);
      if (!roomEntry) {
        trace.error("no room entry", {target});
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
          this.sendReserver(kingdom, target, trace);
        }
      }

      // Determine if we need to send attackers
      if (roomEntry.numTowers > 0 || roomEntry.numKeyStructures > 0) {
        // Locate nearby colonies and spawn war parties
        bases.forEach((baseConfig) => {
          // If we have assigned enough rooms, move on
          if (targetNumBasesAssigned[target] >= MAX_BASES_PER_TARGET) {
            return;
          }

          // Check if base already assigned
          if (baseAssignments[baseConfig.id]) {
            return;
          }

          const baseTrace = trace.withFields({base: baseConfig.primary});
          // TODO check for path to target
          const linearDistance = Game.map.getRoomLinearDistance(baseConfig.primary, target)
          if (linearDistance > COLONY_ATTACK_RANGE) {
            baseTrace.info("linear distance too far", {
              base: baseConfig.primary,
              target, linearDistance, COLONY_ATTACK_RANGE
            });
            return;
          }

          const baseRoom = Game.rooms[baseConfig.primary];
          if (!baseRoom) {
            baseTrace.warn("no base room", {target, baseConfig});
            return;
          }

          trace.info('assigning base', {base: baseConfig.primary, target});
          targetNumBasesAssigned[target]++;
          baseAssignments[baseConfig.id] = target;

          this.attack(kingdom, baseConfig, baseRoom, roomEntry, trace);

          return;
        });
      }
    });

    // Update memory
    (Memory as any).war = {
      targetRooms: this.targets,
      parties: this.warParties.map((party): StoredWarParty => {
        return {
          id: party.id,
          target: party.targetRoom,
          phase: party.phase,
          role: party.role,
          flagId: party.flagId,
          colony: party.baseConfig.id,
          position: party.getPosition(),
          parts: party.parts,
        };
      })
    };
  }

  mapUpdate(trace: Tracer): void {
    if (this.warParties) {
      this.warParties.forEach((party) => {
        Game.map.visual.line(new RoomPosition(25, 25, party.baseConfig.primary), new RoomPosition(25, 25, party.targetRoom), {})
      });
    }

    this.targets.forEach((target) => {
      Game.map.visual.text('❌', new RoomPosition(25, 25, target), {
        align: 'center',
        fontSize: 20,
      });
    });
  }

  attack(kingdom: Kingdom, baseConfig: BaseConfig, baseRoom: Room, targetRoomEntry: RoomEntry, trace: Tracer) {
    const boosts = newMultipliers();

    const baseStorage = baseRoom.storage;
    if (baseStorage) {
      const availableHealingBoost = scoreStorageHealing(baseStorage);
      boosts[HEAL] = availableHealingBoost;
    }

    const availableEnergyCapacity = baseRoom.energyCapacityAvailable;
    const roomDamage = scoreRoomDamage(targetRoomEntry) / 4;
    const [parts, ok] = buildAttacker(roomDamage, availableEnergyCapacity, boosts, trace);
    if (ok) {
      this.sendWarParty(kingdom, baseConfig, targetRoomEntry, parts, trace);
    } else if (targetRoomEntry.invaderCoreLevel < 1) { // don't harass invaders bases
      trace.warn("could not build attacker, harass", {
        base: baseConfig.primary,
        targetRoom: targetRoomEntry.id,
        roomDamage, availableEnergyCapacity, boosts
      });
      this.sendHarassers(kingdom, baseConfig, targetRoomEntry, trace);
    }
  }

  sendReserver(kingdom: Kingdom, target: string, trace: Tracer) {
    const numReservers = _.filter(Game.creeps, (creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return (role === CREEPS.WORKER_RESERVER) &&
        creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === target && creepIsFresh(creep);
    }).length;

    if (numReservers < 1) {
      const details = {
        role: CREEPS.WORKER_RESERVER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_ROOM]: target,
        },
      }

      trace.notice("requesting reserver", {details});
      kingdom.sendRequest(getKingdomSpawnTopic(), PRIORITIES.PRIORITY_RESERVER,
        details, WAR_PARTY_RUN_TTL);
    } else {
      trace.info("reserver already exists", {numReservers});
    }
  }

  sendHarassers(kingdom: Kingdom, baseConfig: BaseConfig, targetRoom: RoomEntry, trace: Tracer) {
    // get number of harassers
    const numHarassers = _.filter(Game.creeps, (creep) => {
      return creep.memory[MEMORY.MEMORY_ROLE] === ROLE_HARASSER &&
        creep.memory[MEMORY.MEMORY_BASE] === baseConfig.id &&
        creep.memory[MEMORY_HARASS_BASE] === targetRoom.id &&
        creepIsFresh(creep);
    });


    // if we have too many, don't bother
    if (numHarassers.length >= MAX_HARASSERS_PER_BASE) {
      trace.info("too many harassers", {numHarassers});
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
    const details = {
      role: ROLE_HARASSER,
      memory: {
        [MEMORY.MEMORY_BASE]: baseConfig.id,
        [MEMORY_HARASS_BASE]: targetRoom.id,
      }
    }

    trace.info("requesting harasser", {details});
    kingdom.sendRequest(getBaseSpawnTopic(baseConfig.id), PRIORITIES.PRIORITY_HARASSER,
      details, WAR_PARTY_RUN_TTL);
  }

  sendWarParty(kingdom: Kingdom, baseConfig: BaseConfig, targetRoom: RoomEntry, parts: BodyPartConstant[],
    trace: Tracer) {
    const numColonyWarParties = this.warParties.filter((party) => {
      return party.baseConfig.id === baseConfig.id;
    }).length;
    if (numColonyWarParties >= MAX_WAR_PARTIES_PER_COLONY) {
      trace.info("too many war parties", {numColonyWarParties});
      return;
    }

    trace.info("colony parties", {
      colonyId: baseConfig.id,
      numColonyWarParties,
      max: MAX_WAR_PARTIES_PER_COLONY
    });

    const flagId = `rally_${baseConfig.primary}`;
    const flag = Game.flags[flagId];
    if (!flag) {
      trace.warn(`not creating war party, no rally flag(${flagId})`);
      return null;
    }

    const partyId = `war_party_${targetRoom.id}_${baseConfig.primary}_${Game.time}`;
    trace.log("creating war party", {target: targetRoom.id, partyId, flagId});

    const warParty = this.createAndScheduleWarParty(baseConfig, partyId, targetRoom.id,
      Phase.PHASE_MARSHAL, flag.pos, flag.name, CREEPS.WORKER_ATTACKER, parts, trace);

    if (warParty) {
      this.warParties.push(warParty);
    }
  }

  createAndScheduleWarParty(baseConfig: BaseConfig, id: string, target: string, phase: Phase,
    position: RoomPosition, flagId: string, role: string, parts: BodyPartConstant[],
    trace: Tracer): WarPartyRunnable {
    const party = new WarPartyRunnable(id, baseConfig, flagId, position, target, role, parts, phase);
    const process = new Process(id, 'war_party', Priorities.OFFENSE, party);
    process.setSkippable(false);
    this.scheduler.registerProcess(process);

    return party;
  }

  private restoreFromMemory(kingdom: Kingdom, trace: Tracer) {
    const memory = (Memory as any);

    trace.info("restore memory", {war: memory.war || null});

    if (!memory.war) {
      memory.war = {
        parties: [],
      };
    }

    this.memory = memory.war;

    this.targets = (Memory as any).war?.targets || [];

    this.warParties = this.memory.parties.map((party) => {
      trace.info("restoring party", {party});

      if (!party.id || !party.target || !party.position || !party.colony || !party.flagId
        || !party.role || !party.parts) {
        trace.error("invalid party", {party});
        return null;
      }

      const position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      const baseConfig = kingdom.getPlanner().getBaseConfigById(party.colony);
      if (!baseConfig) {
        trace.warn('not create war party, cannot find colony config', {colonyId: party.colony});
        return null;
      }

      return this.createAndScheduleWarParty(baseConfig, party.id, party.target, party.phase,
        position, party.flagId, party.role, party.parts, trace);
    }).filter((party) => {
      return party;
    });

    trace.info("restore complete", {
      targets: this.targets,
      warParties: this.warParties.map(warParty => warParty.id),
    });
  }
}
