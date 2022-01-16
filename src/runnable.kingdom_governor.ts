import * as WORKERS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import * as TOPICS from './constants.topics';
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {CreepRequest, ShardMemory} from "./org.scribe";
import {sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";

const SHARD_MEMORY_TTL = 50;

export default class KingdomGovernor {
  threadUpdateShardMemory: ThreadFunc;

  constructor() {
    this.threadUpdateShardMemory = thread('update_shard_memory', SHARD_MEMORY_TTL)(this.updateShardMemory.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('kingdom_governor');

    trace.log('kingdom governor run', {})

    this.threadUpdateShardMemory(trace, kingdom);

    trace.end();

    return sleeping(SHARD_MEMORY_TTL);
  }

  updateShardMemory(trace: Tracer, kingdom: Kingdom) {
    trace.log('update_shard_memory');

    const scribe = kingdom.getScribe();

    let shardMemory = scribe.getLocalShardMemory();

    const baseConfigs = kingdom.getPlanner().getBaseConfigs();
    shardMemory.status = {
      numColonies: baseConfigs.length,
    };

    shardMemory.time = Game.time;
    shardMemory = this.requestClaimersFromOtherShards(kingdom, shardMemory, trace);
    shardMemory = this.requestBuildersFromOtherShards(kingdom, shardMemory, trace);

    kingdom.getPlanner().getShards().forEach((shardName) => {
      if (shardName === Game.shard.name) {
        return;
      }

      let shardMemory = kingdom.getScribe().getRemoteShardMemory(shardName);
      trace.log('shard memory', {shardName, shardMemory});

      this.handleClaimerRequests(kingdom, shardMemory.request_claimer || {}, trace);
      this.handleBuilderRequests(kingdom, shardMemory.request_builder || {}, trace);

      /*
      const shardConfig: ShardConfig = kingdom.getPlanner().getShardConfig(shardName);
      if (!shardConfig) {
        return;
      }

      trace.log('kingdom governor shard', {shardName, shardConfig})

      const primaryColony: BaseConfig = Object.values(shardConfig)[0];
      if (!primaryColony || !primaryColony.primary) {
        return;
      }

      trace.log('kingdom governor colony', {shardName, primaryColony})
     */

      /* TODO
      if (!shardMemory.ttl) {
        shardMemory = this.sendClaimer(shardName, primaryColony.primary, shardMemory, trace);
      }
      */
    });

    trace.log('setting local memory', {shardMemory})

    scribe.setLocalShardMemory(shardMemory);
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
        base: kingdom.getColonies()[0].id,
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

      (kingdom as any).sendRequest(TOPICS.TOPIC_SPAWN, PRIORITIES.PRIORITY_RESERVER, {
        role: WORKERS.WORKER_RESERVER,
        memory: {
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_COLONY]: request.colony,
          [MEMORY.MEMORY_BASE]: request.colony,
        },
      }, SHARD_MEMORY_TTL);

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
        base: kingdom.getColonies()[0].id,
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
          [MEMORY.MEMORY_BASE]: request.colony,
        },
      }, SHARD_MEMORY_TTL);

      trace.log('relaying builder request from remote shard', {request})
    });
  }
}
