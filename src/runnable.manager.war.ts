import * as _ from 'lodash';

import {Priorities, Scheduler} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import WarPartyRunnable from './runnable.warparty';
import * as TOPICS from './constants.topics';
import {Colony} from './org.colony';
import {ATTACK_ROOM_TTL, AttackRequest, AttackStatus, Phase} from './constants.attack';
import {Position} from './lib.flood_fill';

const WAR_PARTY_PROCESS_PRIORITY = 2;
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
  costMatrices: Record<string, CostMatrix>;

  constructor(kingdom: Kingdom, id: string, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.scheduler = scheduler;
    this.warParties = null;
    this.costMatrices = {};
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
      if (!party.id || !party.target || !party.position || !party.colony || !party.flagId) {
        return null;
      }

      const position = new RoomPosition(party.position.x, party.position.y, party.position.roomName);
      const colony = kingdom.getColonyById(party.colony);
      if (!colony) {
        trace.log('not create war party, cannot find colony', {colonyId: party.colony});
        return null;
      }

      return this.createAndScheduleWarParty(colony, party.id, party.target, party.phase,
        position, party.flagId, trace);
    }).filter((party) => {
      return party;
    });

    trace.notice("restore complete", {
      targetRoom: this.targetRoom,
      warParties: this.warParties.map(warParty => warParty.id),
    });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);
    trace = trace.begin('war_manager_run');

    if (this.warParties === null) {
      this.restoreFromMemory(kingdom, trace);
    }

    // Load war parties
    this.warParties = this.warParties.filter((party) => {
      return this.scheduler.hasProcess(party.id);
    });

    // Process events
    let request: any = null;
    while (request = kingdom.getNextRequest(TOPICS.ATTACK_ROOM)) {
      trace.log("attack room request", {request});

      switch (request.details.status) {
        case AttackStatus.REQUESTED:
          if (!this.targetRoom) {
            trace.notice("setting targeting room", {targetRoom: this.targetRoom});
            this.targetRoom = request.details.roomId;
          }
          break;
        case AttackStatus.COMPLETED:
          if (this.targetRoom === request.details.roomId) {
            trace.notice('attack completed', {targetRoom: this.targetRoom});
            kingdom.getScribe().clearRoom(this.targetRoom);
            this.targetRoom = null;
          }
          break;
        default:
          throw new Error(`invalid status ${request.details.status}`);
      }
    }

    // Write post event status
    trace.log("war manager state", {
      targetRoom: this.targetRoom,
      warPartyIds: this.warParties.map(warParty => warParty.id)
    });

    // If we have a target, create war parties and attack
    if (this.targetRoom) {
      // Locate nearby colonies and spawn war parties
      kingdom.getColonies().forEach((colony) => {
        const distance = Game.map.getRoomLinearDistance(colony.primaryRoomId, this.targetRoom)
        trace.log("distance", {distance});

        if (distance <= COLONY_ATTACK_RANGE) {
          const numColonyWarParties = this.warParties.filter((party) => {
            return party.colony === colony;
          }).length;

          trace.log("found parties", {
            colonyId: colony.id,
            numColonyWarParties,
            max: MAX_WAR_PARTIES_PER_COLONY
          });

          if (numColonyWarParties < MAX_WAR_PARTIES_PER_COLONY) {
            this.createNewWarParty(kingdom, colony, trace);
          }
        }
      });
    }

    // Update memory
    (Memory as any).war = {
      targetRoom: this.targetRoom,
      parties: this.warParties.map((party) => {
        return {
          id: party.id,
          target: party.targetRoom,
          phase: party.phase,
          flagId: party.flagId,
          colony: party.getColony().id,
          position: party.getPosition(),
        };
      })
    };

    trace.end();

    return sleeping(WAR_PARTY_RUN_TTL);
  }

  getTargetRoom(): string {
    return this.targetRoom || null;
  }

  getCostMatrix(roomName: string): CostMatrix {
    if (!this.costMatrices[roomName]) {
      const costMatrix = new PathFinder.CostMatrix();


      this.costMatrices[roomName] = costMatrix;
    }

    return this.costMatrices[roomName];
  }

  createNewWarParty(kingdom: Kingdom, colony: Colony, trace: Tracer) {
    const flagId = `rally_${colony.primaryRoomId}`;
    const flag = Game.flags[flagId];
    if (!flag) {
      trace.notice(`not creating war party, no rally flag (${flagId})`);
      return null;
    }

    const partyId = `war_party_${this.targetRoom}_${colony.primaryRoomId}_${Game.time}`;
    trace.notice("creating war party", {target: this.targetRoom, partyId, flagId});
    const warParty = this.createAndScheduleWarParty(colony, partyId, this.targetRoom,
      Phase.PHASE_MARSHAL, flag.pos, flag.name, trace);
    if (warParty) {
      this.warParties.push(warParty);
    }
  }

  createAndScheduleWarParty(colony: Colony, id: string, target: string, phase: Phase,
    position: RoomPosition, flagId: string, trace: Tracer): WarPartyRunnable {
    const party = new WarPartyRunnable(id, colony, flagId, position, target, phase);
    const process = new Process(id, 'war_party', Priorities.OFFENSE, party);
    process.setSkippable(false);
    this.scheduler.registerProcess(process);

    return party;
  }
}
