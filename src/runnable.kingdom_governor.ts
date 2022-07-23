import * as WORKERS from './constants.creeps';
import * as MEMORY from './constants.memory';
import * as PRIORITIES from './constants.priorities';
import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {sleeping} from './os.process';
import {RunnableResult} from './os.runnable';
import {thread, ThreadFunc} from './os.thread';
import {createSpawnRequest, getShardSpawnTopic} from './runnable.base_spawning';
import {CreepRequest, ShardMemory} from './runnable.scribe';

const SHARD_MEMORY_TTL = 50;

export default class KingdomGovernor {
  threadUpdateShardMemory: ThreadFunc;

  constructor() {
    this.threadUpdateShardMemory = thread('update_shard_memory', SHARD_MEMORY_TTL)(this.updateShardMemory.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('kernel_governor');

    trace.log('kernel governor run', {});

    this.threadUpdateShardMemory(trace, kernel);

    trace.end();

    return sleeping(SHARD_MEMORY_TTL);
  }

  updateShardMemory(trace: Tracer, kernel: Kernel) {
    trace.log('update_shard_memory');

    const scribe = kernel.getScribe();

    let shardMemory = scribe.getLocalShardMemory();

    const bases = kernel.getPlanner().getBases();
    shardMemory.status = {
      numColonies: bases.length,
    };

    shardMemory.time = Game.time;
    shardMemory = this.requestClaimersFromOtherShards(kernel, shardMemory, trace);
    shardMemory = this.requestBuildersFromOtherShards(kernel, shardMemory, trace);

    kernel.getPlanner().getShards().forEach((shardName) => {
      if (shardName === Game.shard.name) {
        return;
      }

      const shardMemory = kernel.getScribe().getRemoteShardMemory(shardName);
      trace.log('shard memory', {shardName, shardMemory});

      this.handleClaimerRequests(kernel, shardMemory.request_claimer || new Map(), trace);
      this.handleBuilderRequests(kernel, shardMemory.request_builder || new Map(), trace);

      /* TODO remove if not used Jan 2022
      const shardConfig: ShardConfig = kernel.getPlanner().getShardConfig(shardName);
      if (!shardConfig) {
        return;
      }

      trace.log('kernel governor shard', {shardName, shardConfig})

      const primaryColony: Base = Object.values(shardConfig)[0];
      if (!primaryColony || !primaryColony.primary) {
        return;
      }

      trace.log('kernel governor colony', {shardName, primaryColony})
     */

      /* TODO
      if (!shardMemory.ttl) {
        shardMemory = this.sendClaimer(shardName, primaryColony.primary, shardMemory, trace);
      }
      */
    });

    trace.log('setting local memory', {shardMemory});

    scribe.setLocalShardMemory(shardMemory);
  }

  findCreeps(needle: any): Creep[] {
    return _.filter(Game.creeps, needle);
  }

  requestClaimersFromOtherShards(kernel: Kernel, localMemory: ShardMemory, trace: Tracer): ShardMemory {
    localMemory.request_claimer = new Map();

    // Check if we need to request reservers
    const claimedRooms = Object.values(Game.rooms).filter((room: Room) => {
      return room.controller?.my;
    });

    const bases = kernel.getPlanner().getBases();
    if (!bases.length) {
      return localMemory;
    }

    if (bases.length && !claimedRooms.length) {
      const request = {
        baseId: bases[0].id,
        base: bases[0].id,
        shard: Game.shard.name,
        room: bases[0].primary,
        ttl: Game.time,
      } as CreepRequest;

      const enroute = this.findCreeps({
        memory: {
          [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_RESERVER,
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_BASE]: request.baseId,
        },
      });
      if (!enroute.length) {
        localMemory.request_claimer.set(bases[0].primary, request);
        trace.log('requesting claimer from another shard', {request});
      }
    }

    return localMemory;
  }

  handleClaimerRequests(kernel: Kernel, requests: Map<string, CreepRequest>, trace: Tracer) {
    Array.from(requests.values()).forEach((creepRequest) => {
      const memory = {
        [MEMORY.MEMORY_ASSIGN_SHARD]: creepRequest.shard,
        [MEMORY.MEMORY_ASSIGN_ROOM]: creepRequest.room,
        [MEMORY.MEMORY_BASE]: creepRequest.baseId,
      };

      const enroute = this.findCreeps({
        [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_RESERVER,
        memory,
      });

      trace.log('checking if claimer in-flight', {
        shardName: creepRequest.shard,
        enroute: enroute.map((creep) => creep.id),
      });

      if (enroute.length) {
        return;
      }

      const priorities = PRIORITIES.PRIORITY_RESERVER;
      const ttl = SHARD_MEMORY_TTL;
      const role = WORKERS.WORKER_RESERVER;

      const request = createSpawnRequest(priorities, ttl, role, memory, 0);
      trace.log('relaying claimer request from remote shard', {request});
      kernel.getTopics().addRequestV2(getShardSpawnTopic(), request);
    });
  }

  sendClaimer(shardName: string, roomName: string, memory: ShardMemory, trace: Tracer): ShardMemory {
    const request = {
      shard: shardName,
      room: roomName,
      ttl: Game.time,
    } as CreepRequest;

    if (!memory.request_claimer) {
      memory.request_claimer = new Map();
    }

    memory.request_claimer.set(roomName, request);

    trace.log('adding request for claimer', {request});

    return memory;
  }

  requestBuildersFromOtherShards(kernel: Kernel, localMemory: ShardMemory, trace: Tracer): ShardMemory {
    localMemory.request_builder = new Map();

    // Check if we need to request builders
    const claimedRooms = Object.values(Game.rooms).filter((room: Room) => {
      return room.controller?.my;
    });


    const bases = kernel.getPlanner().getBases();
    if (!bases.length) {
      return localMemory;
    }

    if (!Object.values(Game.spawns).length && claimedRooms.length) {
      const request = {
        baseId: bases[0].id,
        base: bases[0].id,
        shard: Game.shard.name,
        room: bases[0].primary,
        ttl: Game.time,
      } as CreepRequest;

      const enroute = this.findCreeps({
        memory: {
          [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_BUILDER,
          [MEMORY.MEMORY_ASSIGN_SHARD]: request.shard,
          [MEMORY.MEMORY_ASSIGN_ROOM]: request.room,
          [MEMORY.MEMORY_BASE]: request.baseId,
        },
      });
      if (enroute.length < 6) {
        localMemory.request_builder.set(bases[0].primary, request);
        trace.log('requesting builder from another shard', {request});
      }
    }

    return localMemory;
  }

  handleBuilderRequests(kernel: Kernel, requests: Map<string, CreepRequest>, trace: Tracer) {
    Array.from(requests.values()).forEach((creepRequest: CreepRequest) => {
      const memory = {
        [MEMORY.MEMORY_ASSIGN_SHARD]: creepRequest.shard,
        [MEMORY.MEMORY_ASSIGN_ROOM]: creepRequest.room,
        [MEMORY.MEMORY_BASE]: creepRequest.baseId,
      };

      const enroute = this.findCreeps({
        [MEMORY.MEMORY_ROLE]: WORKERS.WORKER_BUILDER,
        memory,
      });

      trace.log('checking if builder in-flight', {shardName: creepRequest.shard, enroute: enroute.map((creep) => creep.id)});

      if (enroute.length) {
        return;
      }

      const priority = PRIORITIES.PRIORITY_BUILDER;
      const ttl = SHARD_MEMORY_TTL;
      const role = WORKERS.WORKER_BUILDER;

      const request = createSpawnRequest(priority, ttl, role, memory, 0);
      trace.log('relaying builder request from remote shard', {request});
      kernel.getTopics().addRequestV2(getShardSpawnTopic(), request);
    });
  }
}
