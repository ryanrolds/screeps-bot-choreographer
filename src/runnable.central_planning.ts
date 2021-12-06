import {ColonyConfig, KingdomConfig, ShardConfig} from "./config";
import {AI} from "./lib.ai";
import {Tracer} from "./lib.tracing";
import {Colony} from "./org.colony";
import {Kingdom} from "./org.kingdom";
import {Process, RunnableResult, running, sleeping} from "./os.process";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import {ColonyManager} from "./runnable.manager.colony";

const RUN_TTL = 20;
const REMOTE_MINING_TTL = 20;

export class CentralPlanning {
  private config: KingdomConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private colonyConfigs: Record<string, ColonyConfig>;
  private remoteMiningThread: ThreadFunc;
  private roomByColonyId: Record<string, string>;

  constructor(config: KingdomConfig, scheduler: Scheduler, trace: Tracer) {
    this.config = config;
    this.scheduler = scheduler;
    this.shards = [];
    this.colonyConfigs = {};
    this.roomByColonyId = {};

    const memory = (Memory as any).shard || null;
    if (memory) {
      trace.notice('found shard memory', {memory});
    } else if (config && config.shards && config.shards[Game.shard.name]) {
      trace.notice('found shard config', {config});
    } else {
      trace.error('no shard config found');
    }

    this.shards.push(Game.shard.name);

    // Check for spawns without colonies
    Object.values(Game.spawns).forEach((spawn) => {
      const roomName = spawn.room.name;
      const origin = new RoomPosition(spawn.pos.x, spawn.pos.y + 4, spawn.pos.roomName);

      if (!this.colonyConfigs[roomName]) {
        this.addColonyConfig(roomName, false, origin, true, trace);
      }
    });

    this.remoteMiningThread = thread('remote_mining', REMOTE_MINING_TTL)(this.remoteMining.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Colony manager
    const colonyManagerId = 'colony_manager';
    if (!this.scheduler.hasProcess(colonyManagerId)) {
      const colonyManager = new ColonyManager(colonyManagerId, this, this.scheduler);
      this.scheduler.registerProcess(new Process(colonyManagerId, 'colony_manager',
        Priorities.CRITICAL, colonyManager));
    }

    this.remoteMiningThread(trace, kingdom)

    return sleeping(RUN_TTL);
  }

  getShards(): string[] {
    return this.shards;
  }

  getColonyConfig(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  getColonyConfigs(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigList(): ColonyConfig[] {
    return _.values(this.colonyConfigs);
  }

  getColonyConfigMap(): Record<string, ColonyConfig> {
    return this.colonyConfigs;
  }

  getColonyConfigById(colonyId: string): ColonyConfig {
    return this.colonyConfigs[colonyId];
  }

  setColonyAutomation(colonyId: string, automated: boolean) {
    this.colonyConfigs[colonyId].automated = automated;
  }

  getUsername() {
    if (!this.username) {
      const spawn = _.first(_.values<StructureSpawn>(Game.spawns));
      if (!spawn) {
        throw new Error('no spawns found');
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

  addColonyConfig(colonyId: string, isPublic: boolean, origin: RoomPosition, automated: boolean,
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
      parking: new RoomPosition(origin.x + 4, origin.y, origin.roomName),
    };
    this.roomByColonyId[colonyId] = colonyId;
  }

  removeColony(colonyId: string, trace: Tracer) {
    delete this.colonyConfigs[colonyId];
  }

  private remoteMining(trace: Tracer, kingdom: Kingdom) {
    this.getColonyConfigList().forEach((colonyConfig) => {
      trace.log('checking remote mining', {colonyConfig});

      const room = Game.rooms[colonyConfig.primary];
      if (!room) {
        trace.log('no room found', {colonyConfig});
        return;
      }

      const level = room?.controller?.level || 0;
      let numDesired = desiredRemotes(level);
      const numCurrent = colonyConfig.rooms.length - 1;
      if (numDesired <= numCurrent) {
        trace.log('remote mining not needed', {numDesired, numCurrent});
        return;
      }

      let exits = colonyConfig.rooms.reduce((acc, roomName) => {
        const exits = Game.map.describeExits(roomName);
        return acc.concat(Object.values(exits));
      }, [] as string[]);


      let adjacentRooms: string[] = _.uniq(exits);

      const scribe = kingdom.getScribe();
      adjacentRooms = _.filter(adjacentRooms, (roomName) => {
        // filter rooms already belonging to a colony
        const colonyConfig = this.getColonyConfigByRoom(roomName);
        if (colonyConfig) {
          trace.log('room already assigned to colony', {roomName});
          return false;
        }

        const roomEntry = scribe.getRoomById(roomName);

        // filter out rooms we have not seen
        if (!roomEntry) {
          trace.log('no room entry found', {roomName});
          return false
        }

        // filter out rooms that do not have a source
        if (roomEntry.numSources === 0) {
          trace.log('room has no sources', {roomName});
          return false;
        }

        return true;
      });

      if (adjacentRooms.length === 0) {
        trace.log('no adjacent rooms found', {adjacentRooms, exits, colonyConfig});
        return;
      }

      adjacentRooms = _.sortBy(adjacentRooms, (roomName) => {
        const route = Game.map.findRoute(colonyConfig.primary, roomName) || [];
        if (route === ERR_NO_PATH) {
          return 9999;
        }

        return route.length;
      });

      trace.log('adding remote', {room: adjacentRooms[0], colonyConfig});

      this.addRoom(colonyConfig.id, adjacentRooms[0], trace);
    });
  }

  private getColonyConfigByRoom(roomName: string): ColonyConfig {
    const colonyId = this.roomByColonyId[roomName];
    if (!colonyId) {
      return null;
    }

    return this.getColonyConfig(colonyId);
  }

  addRoom(colonyId: string, roomName: string, trace: Tracer) {
    let colonyConfig = this.getColonyConfigByRoom(roomName);
    if (colonyConfig) {
      trace.error('room already assigned', {colonyId, roomName});
      return;
    }

    colonyConfig = this.getColonyConfig(colonyId);
    if (!colonyConfig) {
      trace.error('no colony found', {roomName});
      return;
    }

    if (colonyConfig.rooms.indexOf(roomName) !== -1) {
      trace.error('room already exists', {roomName});
      return;
    }

    colonyConfig.rooms.push(roomName);
    this.roomByColonyId[roomName] = colonyId;
  }
}

function desiredRemotes(level: number): number {
  let desiredRemotes = 0;
  switch (level) {
    case 0:
    case 1:
      break;
    case 2:
      desiredRemotes = 2;
      break;
    case 3:
      desiredRemotes = 2;
      break;
    case 4:
      desiredRemotes = 3;
      break;
    case 5:
    case 6:
    case 7:
    case 8:
      desiredRemotes = 4;
      break;
    default:
      throw new Error('unexpected controller level');
  }

  return desiredRemotes;
}
