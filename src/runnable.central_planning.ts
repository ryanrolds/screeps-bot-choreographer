import {ColonyConfig, KingdomConfig, ShardConfig} from "./config";
import {createOpenSpaceMatrix} from "./lib.costmatrix";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {Process, RunnableResult, running, sleeping} from "./os.process";
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import {ColonyManager} from "./runnable.manager.colony";

const RUN_TTL = 20;
const REMOTE_MINING_TTL = 20;
const EXPAND_TTL = 20;
const MIN_DISTANCE_FOR_ORIGIN = 7;

export class CentralPlanning {
  private config: KingdomConfig;
  private scheduler: Scheduler;
  private username: string;
  private shards: string[];
  private colonyConfigs: Record<string, ColonyConfig>;
  private roomByColonyId: Record<string, string>;
  private remoteMiningThread: ThreadFunc;
  private expandThread: ThreadFunc;

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
    this.expandThread = thread('expand', EXPAND_TTL)(this.expand.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Colony manager
    const colonyManagerId = 'colony_manager';
    if (!this.scheduler.hasProcess(colonyManagerId)) {
      const colonyManager = new ColonyManager(colonyManagerId, this, this.scheduler);
      this.scheduler.registerProcess(new Process(colonyManagerId, 'colony_manager',
        Priorities.CRITICAL, colonyManager));
    }

    trace.notice('running central planning', {configs: this.getColonyConfigs()});

    this.remoteMiningThread(trace, kingdom);
    this.expandThread(trace, kingdom);

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

    trace.notice('adding colony', {colonyId, isPublic, origin, automated});

    this.colonyConfigs[colonyId] = {
      id: `${colonyId}`,
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
    trace.notice('removing colony', {colonyId});

    const colonyConfig = this.getColonyConfig(colonyId);
    const rooms = colonyConfig.rooms;
    rooms.forEach((roomName) => {
      this.removeRoom(roomName, trace);
    });

    delete this.colonyConfigs[colonyId];
  }

  private expand(trace: Tracer, kingdom: Kingdom) {
    const colonyConfigs = this.getColonyConfigList();
    const numColonies = colonyConfigs.length;
    const maxColonies = Game.gcl.level;

    if (maxColonies <= numColonies) {
      trace.notice('max colonies reached', {maxColonies, numColonies});
      return;
    }

    let candidates: Record<string, boolean> = {};
    let claimed: Record<string, boolean> = {};
    let dismissed: Record<string, boolean> = {};

    colonyConfigs.forEach((colonyConfig) => {
      claimed[colonyConfig.primary] = true;
      trace.log('adding colony claims', {colonyConfig});
      // Build map of claimed rooms
      colonyConfig.rooms.forEach((roomName) => {
        claimed[roomName] = true;
      });

      trace.log('claimed rooms', {claimedRooms: _.keys(claimed)});

      const colonyCandidates: Record<string, boolean> = {};

      let nextPass = [colonyConfig.primary];
      for (let i = 0; i <= 3; i++) {
        const found = [];

        nextPass.forEach((roomName) => {
          _.forEach(Game.map.describeExits(roomName), (adjRoom, key) => {
            // Check room in next pass
            found.push(adjRoom);

            const roomEntry = kingdom.getScribe().getRoomById(roomName);
            if (!roomEntry) {
              trace.log('no room entry', {roomName});
              return;
            }

            if (!roomEntry.controller) {
              trace.log('dismiss candidate, no controller', {roomName, roomEntry});
              return;
            }

            if (!roomEntry.controller.pos) {
              trace.log('dismiss candidate, no controller position', {roomName, roomEntry});
              return;
            }

            if (roomEntry.controller.owner) {
              trace.log('dismissed room owned', {roomName, roomEntry});
              claimed[roomName] = true;
              return;
            }

            if (dismissed[adjRoom]) {
              trace.log('room already dismissed', {roomName, adjRoom});
              return;
            }

            if (claimed[adjRoom]) {
              trace.log('room is claimed', {roomName, adjRoom});
              return;
            }

            // If previous room was claimed, do not build as this room is too close to another colony
            if (claimed[roomName]) {
              dismissed[adjRoom] = true;
              trace.log('dismissing room, parent claimed', {roomName, adjRoom});
              return;
            }

            trace.log('adding room to candidates', {roomName, adjRoom});
            colonyCandidates[adjRoom] = true;
          });
        });

        nextPass = found;
      }

      candidates = _.assign(candidates, colonyCandidates);
    });

    let candidateList = _.keys(candidates);
    const claimedList = _.keys(claimed);
    const dismissedList = _.keys(dismissed);

    trace.log('claimed', {claimedList});
    trace.log('dismissed', {dismissedList});
    trace.log('pre-filter candidates', {candidateList});

    candidateList = _.sortByOrder(candidateList,
      (roomName) => {
        const roomEntry = kingdom.getScribe().getRoomById(roomName);
        if (!roomEntry) {
          trace.error('no room entry', {roomName});
          return 0;
        }

        trace.log('room source', {roomName, numSources: roomEntry.numSources, roomEntry});
        return roomEntry.numSources;
      },
      ['desc']
    );

    trace.log('sorted candidates', {candidateList, claimedList});

    if (candidateList.length < 5) {
      trace.notice('not enough candidates', {candidateList});
      return;
    }

    for (let i = 0; i < candidateList.length; i++) {
      const roomName = candidateList[i];
      const [costMatrix, distance, origin] = createOpenSpaceMatrix(roomName, trace);
      trace.log('open space matrix', {roomName, distance, origin});

      if (distance >= MIN_DISTANCE_FOR_ORIGIN) {
        trace.log('selected room, adding colony', {roomName, distance, origin});
        this.addColonyConfig(roomName, false, origin, true, trace);
        return;
      }
    }
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
        colonyConfig.rooms = colonyConfig.rooms.slice(0, numDesired + 1);

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

  removeRoom(roomName: string, trace: Tracer) {
    const colonyConfig = this.getColonyConfigByRoom(roomName);
    colonyConfig.rooms = _.without(colonyConfig.rooms, roomName);
    delete this.roomByColonyId[roomName];
  }
}

function desiredRemotes(level: number): number {
  let desiredRemotes = 0;
  switch (level) {
    case 0:
    case 1:
      break; // 0
    case 2:
    case 3:
    case 4:
      desiredRemotes = 2;
      break;
    case 5:
    case 6:
      // Increased size of haulers causes spawning bottleneck
      desiredRemotes = 1;
      break;
    case 7:
      desiredRemotes = 3;
    case 8:
      desiredRemotes = 4;
      break;
    default:
      throw new Error('unexpected controller level');
  }

  return desiredRemotes;
}
