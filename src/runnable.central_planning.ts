import {ColonyConfig, KingdomConfig, ShardConfig} from "./config";
import {AI} from "./lib.ai";
import {Tracer} from "./lib.tracing";
import {Colony} from "./org.colony";
import {Kingdom} from "./org.kingdom";
import {Process, RunnableResult, running, sleeping} from "./os.process";
import {Priorities, Scheduler} from "./os.scheduler";
import {ColonyManager} from "./runnable.manager.colony";

const RUN_TTL = 20;

export class CentralPlanning {
  private config: KingdomConfig;
  private scheduler: Scheduler;
  private shard: ShardConfig;
  private shards: string[];

  private colonyConfigs: Record<string, ColonyConfig>;

  private username: string;
  private buffer: number;

  constructor(config: KingdomConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];

    const memory = (Memory as any).shard || null;
    if (memory) {
      trace.notice('found shard memory', {memory});
      this.shard = memory;
    } else if (config && config.shards && config.shards[Game.shard.name]) {
      trace.notice('found shard config', {config});
      const shardConfig = config.shards[Game.shard.name];
      this.shard = shardConfig;
    } else {
      trace.error('no shard config found');
      this.shard = {};
    }

    this.shards.push(Game.shard.name);

    // Check for spawns without colonies
    Object.values(Game.spawns).forEach((spawn) => {
      const roomName = spawn.room.name;
      const origin = spawn.pos;
      origin.x + 4;

      this.addColony(roomName, false, origin, false, trace);
    });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Colony manager
    const colonyManagerId = 'colony_manager';
    if (!this.scheduler.hasProcess(colonyManagerId)) {
      const colonyManager = new ColonyManager(colonyManagerId, this, this.scheduler);
      this.scheduler.registerProcess(new Process(colonyManagerId, 'colony_manager',
        Priorities.CRITICAL, colonyManager));
    }

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getColonyConfigs(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigById(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  getShardConfig(): ShardConfig {
    return this.shard;
  }

  getUsername() {
    if (!this.username) {
      const spawn = _.first(_.values<StructureSpawn>(Game.spawns));
      if (spawn) {
        throw new Error('not implemented');
      }

      this.username = spawn.owner.username;
    }

    return this.username;
  }

  // TODO move to planner
  getFriends(): string[] {
    return this.config.friends;
  }

  getAvoid(): string[] {
    return this.config.avoid;
  }

  getKOS(): string[] {
    return this.config.kos;
  }

  getBuffer() {

  }

  setBuffer() {

  }

  addColony(colonyId: string, isPublic: boolean, origin: RoomPosition, automated: boolean,
    trace: Tracer) {
    if (this.colonyConfigs[colonyId]) {
      trace.error('colony already exists', {colonyId});
      return;
    }

    trace.log('adding colony', {colonyId, isPublic, origin, automated});

    this.colonyConfigs[colonyId] = {
      id: colonyId,
      isPublic: isPublic,
      primary: colonyId,
      rooms: [colonyId],
      automated: automated,
      origin: origin,
    };
  }

  removeColony(colonyId: string, trace: Tracer) {
    delete this.shard.colonyConfigs[colonyId];
  }
}
