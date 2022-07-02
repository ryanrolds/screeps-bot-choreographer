import {creepIsFresh} from './behavior.commute';
import {AlertLevel, Base} from './config';
import {WORKER_HARVESTER} from "./constants.creeps";
import * as MEMORY from "./constants.memory";
import {roadPolicy} from "./constants.pathing_policies";
import {PRIORITY_MINER} from "./constants.priorities";
import {Event} from "./lib.event_broker";
import {getPath} from "./lib.pathing";
import {Tracer} from './lib.tracing';
import {Colony} from './org.colony';
import OrgRoom from "./org.room";
import {PersistentMemory} from "./os.memory";
import {sleeping, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getLogisticsTopic, LogisticsEventData, LogisticsEventType} from "./runnable.base_logistics";
import {createSpawnRequest, getBaseSpawnTopic, requestSpawn} from './runnable.base_spawning';
import {getLinesStream, HudEventSet, HudLine} from './runnable.debug_hud';

const STRUCTURE_TTL = 50;
const DROPOFF_TTL = 200;
const REQUEST_WORKER_TTL = 50;
const REQUEST_HAULING_TTL = 20;
const PRODUCE_EVENTS_TTL = 20;
const BUILD_LINK_TTL = 200;
const RED_ALERT_TTL = 200;

const CONTAINER_TTL = 250;

export default class MineralRunnable extends PersistentMemory implements Runnable {
  id: string;
  orgRoom: OrgRoom;
  mineralId: Id<Mineral>;
  position: RoomPosition;
  creepPosition: RoomPosition | null;

  ttl: number;
  workerTTL: number;

  dropoffId: Id<Structure>;

  threadProduceEvents: ThreadFunc;
  threadUpdateDropoff: ThreadFunc;
  threadRequestHarvesters: ThreadFunc;
  threadBuildExtractor: ThreadFunc;

  constructor(room: OrgRoom, mineral: Mineral) {
    super(mineral.id);

    this.id = mineral.id;
    this.orgRoom = room;
    this.mineralId = mineral.id;
    this.position = mineral.pos;
    this.creepPosition = null;

    this.threadProduceEvents = thread('consume_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
    this.threadUpdateDropoff = thread('update_dropoff', DROPOFF_TTL)(this.updateDropoff.bind(this));
    this.threadRequestHarvesters = thread('request_miners', REQUEST_WORKER_TTL)(this.requestHarvesters.bind(this));
    this.threadBuildExtractor = thread('build_extractor', CONTAINER_TTL)(this.buildExtractor.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('mineral_run')

    trace.log('mineral run', {
      roomId: this.orgRoom.id,
      mineralId: this.mineralId,
      creepPosition: this.creepPosition,
    });

    const mineral: Mineral = Game.getObjectById(this.mineralId);
    if (!mineral) {
      trace.error('mineral not found', {id: this.mineralId});
      trace.end();
      return terminate();
    }

    const base = kingdom.getPlanner().getBaseByRoom(mineral.room.name);
    if (!base) {
      trace.error('no colony config', {room: mineral.room.name});
      trace.end();
      return terminate();
    }

    // If red alert, don't do anything
    if (base.alertLevel === AlertLevel.RED) {
      trace.error('red alert', {room: mineral.room.name});
      trace.end();
      return sleeping(RED_ALERT_TTL);
    }

    if (!this.creepPosition) {
      this.populatePositions(trace, kingdom, base, mineral);
    }

    // TODO try to remove the need for this
    const colony = this.orgRoom.getColony();
    if (!colony) {
      trace.error('no colony');
      trace.end();
      return terminate();
    }

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.error('terminate mineral: no room', {id: this.id, roomId: this.orgRoom.id});
      trace.end();
      return terminate();
    }

    this.threadProduceEvents(trace, kingdom, mineral);
    this.threadUpdateDropoff(trace, colony);
    this.threadRequestHarvesters(trace, kingdom, base, colony, room, mineral);
    this.threadBuildExtractor(trace, room, mineral);

    trace.end();

    let sleepFor = 100;
    if (mineral.mineralAmount === 0) {
      sleepFor = mineral.ticksToRegeneration;
    }

    return sleeping(sleepFor)
  }

  produceEvents(trace: Tracer, kernel: Kernel, mineral: Mineral) {
    const creepPosition = this.creepPosition;
    if (!creepPosition) {
      trace.error('no creep position', {room: mineral.room.name});
      return;
    }

    const base = kingdom.getPlanner().getBaseByRoom(mineral.room.name);
    if (!base) {
      trace.error('no colony config', {room: mineral.room.name});
      return;
    }

    const data: LogisticsEventData = {
      id: mineral.id,
      position: creepPosition,
    };

    kingdom.getBroker().getStream(getLogisticsTopic(base.id)).
      publish(new Event(this.id, Game.time, LogisticsEventType.RequestRoad, data));

    const hudLine: HudLine = {
      key: `${this.id}`,
      room: mineral.room.name,
      text: `mineral(${mineral.id}) - `,
      time: Game.time,
      order: 4,
    };

    kingdom.getBroker().getStream(getLinesStream()).publish(new Event(this.id, Game.time,
      HudEventSet, hudLine));
  }

  populatePositions(trace: Tracer, kernel: Kernel, base: Base, mineral: Mineral) {
    trace.log('populate positions', {room: mineral.room.name});

    const memory = this.getMemory(trace) || {};

    // Check memory for creep position
    const creepPosition = memory.creepPosition;
    if (creepPosition) {
      trace.log('creep position in memory', {room: mineral.room.name});
      this.creepPosition = new RoomPosition(creepPosition.x, creepPosition.y, creepPosition.roomName);
    }

    const colonyPos = new RoomPosition(base.origin.x, base.origin.y - 1,
      base.origin.roomName);

    const [pathResult, details] = getPath(kingdom, mineral.pos, colonyPos, roadPolicy, trace);
    trace.log('path found', {origin: mineral.pos, dest: colonyPos, pathResult});

    if (!pathResult || !pathResult.path.length) {
      trace.error('path not found', {colonyPos, mineral: mineral.pos});
      return;
    }

    trace.log('creep position set', {creepPosition: this.creepPosition});
    this.creepPosition = pathResult.path[0];

    // Update memory
    memory.creepPosition = this.creepPosition;

    this.setMemory(memory, false);
  }

  updateDropoff(trace: Tracer, colony: Colony) {
    const primaryRoom = colony.getPrimaryRoom();
    this.dropoffId = primaryRoom.getReserveStructureWithRoomForResource(RESOURCE_ENERGY)?.id;
  }

  requestHarvesters(trace: Tracer, kernel: Kernel, base: Base, colony: Colony,
    room: Room, mineral: Mineral) {
    if (mineral.mineralAmount === 0) {
      trace.log('no minerals to harvest')
      return;
    }

    if (!this.creepPosition) {
      trace.error('creep position not set', {creepPosition: this.creepPosition});
      return;
    }

    const username = kingdom.getPlanner().getUsername();
    if (room.controller?.owner && room.controller.owner.username !== username) {
      trace.log('room owned by someone else', {roomId: room.name, owner: room.controller?.owner?.username});
      return;
    }

    const baseCreeps = kingdom.creepManager.getCreepsByBase(base.id);
    const numHarvesters = baseCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === WORKER_HARVESTER &&
        creep.memory[MEMORY.MEMORY_SOURCE] === this.mineralId &&
        creepIsFresh(creep);
    }).length;

    trace.log('num harvesters', {numHarvesters});

    if (numHarvesters < 1) {
      let positionStr = [this.creepPosition.x, this.creepPosition.y, this.creepPosition.roomName].join(',');

      const memory = {
        [MEMORY.MEMORY_SOURCE]: this.mineralId,
        [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
        [MEMORY.MEMORY_ASSIGN_ROOM]: room.name,
        [MEMORY.MEMORY_BASE]: this.orgRoom.getColony().id,
      }

      trace.log('requesting harvester', {mineralId: this.mineralId, memory});

      const request = createSpawnRequest(PRIORITY_MINER, REQUEST_WORKER_TTL, WORKER_HARVESTER, memory, 0);
      requestSpawn(kingdom, getBaseSpawnTopic(base.id), request);
    }
  }

  buildExtractor(trace: Tracer, room: Room, mineral: Mineral) {
    if (room.controller?.level < 6) {
      trace.log('room too low for extractor', {id: this.mineralId});
      return;
    }

    const extractor = mineral.pos.lookFor(LOOK_STRUCTURES).find((structure) => {
      return structure.structureType === STRUCTURE_EXTRACTOR;
    });

    if (!extractor) {
      const site = mineral.pos.lookFor(LOOK_CONSTRUCTION_SITES).find((site) => {
        return site.structureType === STRUCTURE_EXTRACTOR;
      });

      if (!site) {
        room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);

        trace.warn('building extractor', {id: this.mineralId});
      }
    }
  }
}
