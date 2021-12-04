import {ColonyConfig, KingdomConfig, ShardConfig} from "./config";
import {AI} from "./lib.ai";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {RunnableResult, running} from "./os.process";

export class CentralPlanning {
  config: KingdomConfig;
  username: string;
  buffer: number;
  shard: ShardConfig;
  colonies: Record<string, ColonyConfig>;

  constructor(config: KingdomConfig, trace: Tracer) {
    this.config = config;

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

    // Check for spawns without colonies
    _.forEach(Game.spawns, (spawn) => {
      const roomName = spawn.room.name;
      const origin = spawn.pos;
      origin.x + 4;

      this.addColony(roomName, false, origin, false, trace);
    });
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    return running();
  }

  getShardConfig(): ShardConfig {
    return this.shard;
  }

  getUsername() {

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

  addColony(roomName: string, isPublic: boolean, origin: RoomPosition, automated: boolean,
    trace: Tracer) {
    if (this.shard.colonies[roomName]) {
      trace.error('colony already exists', {roomName});
      return;
    }

    trace.log('adding colony', {roomName, isPublic, origin, automated});

    this.shard.colonies[roomName] = {
      id: roomName,
      isPublic: isPublic,
      primary: roomName,
      rooms: [roomName],
      automated: automated,
      origin: origin,
    };
  }

  removeColony() {

  }
}
