import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, RunnableResult, running, sleeping} from "./os.process";
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
import {RoomEntry} from './org.scribe';
import {ColonyConfig} from './config';

const WAR_PARTY_RUN_TTL = 20;
const COLONY_ATTACK_RANGE = 5;
const MAX_WAR_PARTIES_PER_COLONY = 1;
interface StoredWarParty {
  id: string;
  target: string;
  flagId: string;
  position: RoomPosition;
  colony: string;
  phase: Phase;
  role: string;
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
  targets: string[] = [];

  updateWarPartiesThread: ThreadFunc;
  processEventsThread: ThreadFunc;
  mapUpdateThread: ThreadFunc;

  constructor(kingdom: Kingdom, id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.warParties = null;

    this.processEventsThread = thread('events_thread', WAR_PARTY_RUN_TTL)(this.processEvents.bind(this));
    this.updateWarPartiesThread = thread('update_warparties', WAR_PARTY_RUN_TTL)(this.updateWarParties.bind(this));
    this.mapUpdateThread = thread('map_thread', 1)(this.mapUpdate.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('war_manager_run');

    this.processEventsThread(trace, kingdom);
    this.updateWarPartiesThread(trace, kingdom);
    this.mapUpdateThread(trace);

    trace.end();

    // Write post event status
    trace.log("war manager state", {
      targetRoom: this.targetRoom,
      targets: this.targets,
      warPartyIds: this.warParties.map(warParty => warParty.id)
    });

    return running();
  }

  processEvents(trace: Tracer, kingdom: Kingdom) {
    // Process events
    let targets: string[] = [];
    const topic = kingdom.getTopics().getTopic(TOPICS.ATTACK_ROOM);
    if (!topic) {
      trace.log("no attack room topic");
      return;
    }

    trace.log("processing events", {length: topic.length});
    let event = null;
    while (event = topic.shift()) {
      switch (event.details.status) {
        case AttackStatus.REQUESTED:
          trace.notice("requested", {target: event.details.target});
          targets.push(event.details.roomId);
          break;
        case AttackStatus.COMPLETED:
          trace.notice('attack completed', {roomId: event.details.roomId});
          kingdom.getScribe().clearRoom(this.targetRoom);
          targets = targets.filter(target => target !== this.targetRoom);
          this.targetRoom = null;
          break;
        default:
          throw new Error(`invalid status ${event.details.status}`);
      }
    }

    trace.notice(`targets: ${targets} `);

    // TODO spread targets across colonies
    this.targets = targets;

    if (!this.targetRoom && this.targets.length) {
      trace.notice("setting target room", {target: this.targets[0]});
      this.targetRoom = this.targets[0];
    }
  }

  updateWarParties(trace: Tracer, kingdom: Kingdom) {
    if (this.warParties === null) {
      this.restoreFromMemory(kingdom, trace);
    }

    // Update list of war parties
    this.warParties = this.warParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });


    if (!this.targetRoom) {
      trace.log("no target room");
      return;
    }

    // Send reserver to block controller if room is clear
    const roomEntry = kingdom.getScribe().getRoomById(this.targetRoom);
    if (!roomEntry) {
      trace.log("no room entry");
      return;
    }

    const targetsByColony = this.getTargetsByColony(kingdom, this.targets, trace);
    trace.log("targets by colony", {targetsByColony});

    // Send war parties if there are important structures
    if (roomEntry && roomEntry.numKeyStructures > 0) {
      // Locate nearby colonies and spawn war parties
      kingdom.getPlanner().getColonyConfigs().forEach((colonyConfig) => {
        // TODO check for path to target
        const linearDistance = Game.map.getRoomLinearDistance(colonyConfig.primary, this.targetRoom)
        trace.log("linear distance", {linearDistance});

        if (linearDistance > COLONY_ATTACK_RANGE) {
          return;
        }

        const numColonyWarParties = this.warParties.filter((party) => {
          return party.colonyConfig.id === colonyConfig.id;
        }).length;

        trace.log("colony parties", {
          colonyId: colonyConfig.id,
          numColonyWarParties,
          max: MAX_WAR_PARTIES_PER_COLONY
        });

        if (numColonyWarParties < MAX_WAR_PARTIES_PER_COLONY) {
          this.createNewWarParty(kingdom, colonyConfig, roomEntry, trace);
        }
      });
    } else {
      trace.log("no key structures, war parties not needed");
    }

    // Send reservers to block if no towers
    if (roomEntry.numTowers === 0 && roomEntry.controller?.level > 0) {
      trace.log('no towers and still claimed, send reserver')

      const numReservers = _.filter(Game.creeps, (creep) => {
        const role = creep.memory[MEMORY.MEMORY_ROLE];
        return (role === CREEPS.WORKER_RESERVER) &&
          creep.memory[MEMORY.MEMORY_ASSIGN_ROOM] === this.targetRoom && creepIsFresh(creep);
      }).length;

      if (numReservers < 1) {
        const details = {
          role: CREEPS.WORKER_RESERVER,
          memory: {
            [MEMORY.MEMORY_ASSIGN_ROOM]: this.targetRoom,
          },
        }

        trace.log("requesting reserver", {details});

        kingdom.sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_RESERVER,
          details, WAR_PARTY_RUN_TTL);
      }
    }

    // Update memory
    (Memory as any).war = {
      targetRoom: this.targetRoom,
      parties: this.warParties.map((party) => {
        return {
          id: party.id,
          target: party.targetRoom,
          phase: party.phase,
          role: party.role,
          flagId: party.flagId,
          colony: party.colonyConfig.id,
          position: party.getPosition(),
        };
      })
    };
  }

  mapUpdate(trace: Tracer): void {
    this.warParties.forEach((party) => {
      Game.map.visual.line(new RoomPosition(25, 25, party.colonyConfig.primary), new RoomPosition(25, 25, party.targetRoom), {})
    });

    if (this.getTargetRoom()) {
      Game.map.visual.text('❌', new RoomPosition(25, 25, this.targetRoom), {
        align: 'center',
        fontSize: 20,
      });
    }
  }

  getTargetsByColony(kingdom: Kingdom, targets: string[], trace: Tracer): Record<string, string[]> {
    const targetsByColony = _.groupBy(targets)

    return targetsByColony;
  }

  getTargetRoom(): string {
    return this.targetRoom || null;
  }

  createNewWarParty(kingdom: Kingdom, colonyConfig: ColonyConfig, targetRoom: RoomEntry, trace: Tracer) {
    const flagId = `rally_${colonyConfig.primary}`;
    const flag = Game.flags[flagId];
    if (!flag) {
      trace.log(`not creating war party, no rally flag(${flagId})`);
      return null;
    }

    let role = CREEPS.WORKER_ATTACKER;
    switch (targetRoom.numTowers) {
      case 0:
        role = CREEPS.WORKER_ATTACKER;
        break;
      case 1:
        role = CREEPS.WORKER_ATTACKER_1TOWER;
        break;
      case 2:
        role = CREEPS.WORKER_ATTACKER_2TOWER;
        break;
      case 3:
        role = CREEPS.WORKER_ATTACKER_3TOWER;
        break;
      case 4:
      case 5:
      case 6:
        role = CREEPS.WORKER_ATTACKER_6TOWER;
        break;
      default:
        throw new Error(`invalid number of towers ${targetRoom.numTowers}`);
    }

    const partyId = `war_party_${this.targetRoom}_${colonyConfig.primary}_${Game.time}`;
    trace.notice("creating war party", {target: this.targetRoom, partyId, flagId});

    const warParty = this.createAndScheduleWarParty(colonyConfig, partyId, this.targetRoom,
      Phase.PHASE_MARSHAL, flag.pos, flag.name, role, trace);

    if (warParty) {
      this.warParties.push(warParty);
    }
  }

  createAndScheduleWarParty(colonyConfig: ColonyConfig, id: string, target: string, phase: Phase,
    position: RoomPosition, flagId: string, role: string, trace: Tracer): WarPartyRunnable {
    const party = new WarPartyRunnable(id, colonyConfig, flagId, position, target, role, phase);
    const process = new Process(id, 'war_party', Priorities.OFFENSE, party);
    process.setSkippable(false);
    this.scheduler.registerProcess(process);

    return party;
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
      if (!party.id || !party.target || !party.position || !party.colony || !party.flagId
        || !party.role) {
        return null;
      }

      const position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      const colonyConfig = kingdom.getPlanner().getColonyConfigById(party.colony);
      if (!colonyConfig) {
        trace.log('not create war party, cannot find colony config', {colonyId: party.colony});
        return null;
      }

      return this.createAndScheduleWarParty(colonyConfig, party.id, party.target, party.phase,
        position, party.flagId, party.role, trace);
    }).filter((party) => {
      return party;
    });

    trace.notice("restore complete", {
      targetRoom: this.targetRoom,
      warParties: this.warParties.map(warParty => warParty.id),
    });
  }
}
