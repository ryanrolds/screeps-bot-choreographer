import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {ColonyConfig, ShardConfig} from "./config";

import * as MEMORY from './constants.memory';
import * as WORKERS from './constants.creeps';
import * as TOPICS from './constants.topics';
import * as PRIORITIES from './constants.priorities';

const REQUEST_TTL = 1;
const shardsNames = ['shard0', 'shard1', 'shard2', 'shard3'];

interface CreepRequest {
  shard: string;
  colony: string;
  room: string;
  ttl: number;
}

interface ShardMemory {
  ttl: number;
  request_claimer: Record<string, CreepRequest>,
  request_builder: Record<string, CreepRequest>,
  creep_backups: Record<string, CreepMemory>,
}

export default class KingdomGovernor {
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    trace.log('kingdom governor run', {})

    let localMemory = kingdom.getScribe().getLocalShardMemory();
    localMemory.ttl = Game.time;
    localMemory = this.requestClaimersFromOtherShards(kingdom, localMemory, trace);
    localMemory = this.requestBuildersFromOtherShards(kingdom, localMemory, trace);

    shardsNames.forEach((shardName) => {
      if (shardName === Game.shard.name) {
        return;
      }

      const shardConfig: ShardConfig = kingdom.getShardConfig(shardName);
      if (!shardConfig) {
        return;
      }

      trace.log('kingdom governor shard', {shardName, shardConfig})

      const primaryColony: ColonyConfig = Object.values(shardConfig)[0];
      if (!primaryColony || !primaryColony.primary) {
        return;
      }

      trace.log('kingdom governor colony', {shardName, primaryColony})

      let shardMemory = kingdom.getScribe().getRemoteShardMemory(shardName);
      trace.log('shard memory', {shardName, shardMemory})

      if (!shardMemory.ttl) {
        shardMemory = this.sendClaimer(shardName, primaryColony.primary, shardMemory, trace);
      }

      this.handleClaimerRequests(kingdom, shardMemory.request_claimer || {}, trace);
      this.handleBuilderRequests(kingdom, shardMemory.request_builder || {}, trace);
    });

    trace.log('setting local memory', {localMemory})

    kingdom.getScribe().setLocalShardMemory(localMemory);

    return sleeping(REQUEST_TTL);
  }

  findCreeps(needle: any): Creep[] {
    return _.filter(Game.creeps, needle);
  }

  requestClaimersFromOtherShards(kingdom: Kingdom, localMemory: ShardMemory, trace: Tracer): ShardMemory {
    localMemory.request_claimer = {};

    // Check if we need to request reservers
    const claimedRooms = Object.values(Game.rooms).filter((room: Room) => {
      return room.controller?.my;
    });

    if (kingdom.getColonies().length && !claimedRooms.length) {
      const request = {
        colony: kingdom.getColonies()[0].id,
        shard: Game.shard.name,
        room: kingdom.getColonies()[0].primaryRoomId,
        ttl: Game.time,
      } as CreepRequest;

      const enroute = this.findCreeps({
        memory: {
          [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_RESERVER,
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
        }
      });
      if (!enroute.length) {
        localMemory.request_claimer[kingdom.getColonies()[0].primaryRoomId] = request;
        trace.log('requesting claimer from another shard', {request});
      }
    }

    return localMemory;
  }

  handleClaimerRequests(kingdom: Kingdom, requests: Record<string, CreepRequest>, trace: Tracer) {
    Object.values(requests).forEach((request: CreepRequest) => {
      const enroute = this.findCreeps({
        memory: {
          [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_RESERVER,
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
        }
      });

      trace.log('checking if claimer in-flight', {shardName: request.shard, enroute: enroute.map(creep => creep.id)})

      if (enroute.length) {
        return;
      }

      (kingdom as any).sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_CLAIMER, {
        role: WORKERS.WORKER_RESERVER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
        },
      }, REQUEST_TTL);

      trace.log('relaying claimer request from remote shard', {request})
    });
  }

  sendClaimer(shardName: string, roomName: string, memory: ShardMemory, trace: Tracer): ShardMemory {
    const request = {
      shard: shardName,
      room: roomName,
      ttl: Game.time,
    } as CreepRequest;

    if (!memory.request_claimer) {
      memory.request_claimer = {};
    }

    memory.request_claimer[roomName] = request

    trace.log('adding request for claimer', {request})

    return memory;
  }

  requestBuildersFromOtherShards(kingdom: Kingdom, localMemory: ShardMemory, trace: Tracer): ShardMemory {
    localMemory.request_builder = {};

    // Check if we need to request builders
    const claimedRooms = Object.values(Game.rooms).filter((room: Room) => {
      return room.controller?.my;
    });

    if (!Object.values(Game.spawns).length && claimedRooms.length) {
      const request = {
        colony: kingdom.getColonies()[0].id,
        shard: Game.shard.name,
        room: kingdom.getColonies()[0].primaryRoomId,
        ttl: Game.time,
      } as CreepRequest;

      const enroute = this.findCreeps({
        memory: {
          [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_BUILDER,
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
        }
      });
      if (enroute.length < 6) {
        localMemory.request_builder[kingdom.getColonies()[0].primaryRoomId] = request;
        trace.log('requesting builder from another shard', {request});
      }
    }

    return localMemory;
  }

  handleBuilderRequests(kingdom: Kingdom, requests: Record<string, CreepRequest>, trace: Tracer) {
    Object.values(requests).forEach((request: CreepRequest) => {
      const enroute = this.findCreeps({
        memory: {
          [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_BUILDER,
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
        }
      });

      trace.log('checking if builder in-flight', {shardName: request.shard, enroute: enroute.map(creep => creep.id)})

      if (enroute.length) {
        return;
      }

      (kingdom as any).sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_BUILDER, {
        role: WORKERS.WORKER_BUILDER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
        },
      }, REQUEST_TTL);

      trace.log('relaying builder request from remote shard', {request})
    });
  }
}
