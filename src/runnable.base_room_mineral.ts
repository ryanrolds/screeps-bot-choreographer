import {AlertLevel, Base, BaseThreadFunc, getStructureForResource, threadBase} from './base';
import {creepIsFresh} from './behavior.commute';
import {WORKER_HARVESTER} from './constants.creeps';
import * as MEMORY from './constants.memory';
import {roadPolicy} from './constants.pathing_policies';
import {PRIORITY_MINER} from './constants.priorities';
import {Kernel} from './kernel';
import {Event} from './lib.event_broker';
import {getPath} from './lib.pathing';
import {Tracer} from './lib.tracing';
import {PersistentMemory} from './os.memory';
import {sleeping, terminate} from './os.process';
import {Runnable, RunnableResult} from './os.runnable';
import {getLogisticsTopic, LogisticsEventData, LogisticsEventType} from './runnable.base_logistics';
import {createSpawnRequest, getBaseSpawnTopic} from './runnable.base_spawning';
import {getLinesStream, HudEventSet, HudLine} from './runnable.debug_hud';

const STRUCTURE_TTL = 50;
const DROPOFF_TTL = 200;
const REQUEST_WORKER_TTL = 50;
const REQUEST_HAULING_TTL = 20;
const PRODUCE_EVENTS_TTL = 50;
const BUILD_LINK_TTL = 200;
const RED_ALERT_TTL = 200;

const CONTAINER_TTL = 250;

export default class MineralRunnable extends PersistentMemory implements Runnable {
  id: string;
  position: RoomPosition;
  creepPosition: RoomPosition | null;

  ttl: number;
  workerTTL: number;

  dropoffId: Id<Structure>;

  threadProduceEvents: BaseThreadFunc;
  threadUpdateDropoff: BaseThreadFunc;
  threadRequestHarvesters: BaseThreadFunc;
  threadBuildExtractor: BaseThreadFunc;

  constructor(mineral: Mineral) {
    super(mineral.id);

    this.id = mineral.id;
    this.position = mineral.pos;
    this.creepPosition = null;

    this.threadProduceEvents = threadBase('consume_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
    this.threadUpdateDropoff = threadBase('update_dropoff', DROPOFF_TTL)(this.updateDropoff.bind(this));
    this.threadRequestHarvesters = threadBase('request_miners', REQUEST_WORKER_TTL)(this.requestHarvesters.bind(this));
    this.threadBuildExtractor = threadBase('build_extractor', CONTAINER_TTL)(this.buildExtractor.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('mineral_run');

    trace.log('mineral run', {
      mineralId: this.id,
      position: this.position,
      creepPosition: this.creepPosition,
    });

    const mineral: Mineral = Game.getObjectById(this.id);
    if (!mineral) {
      trace.error('mineral not found', {id: this.id});
      trace.end();
      return terminate();
    }

    const base = kernel.getPlanner().getBaseByRoom(mineral.room.name);
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
      this.populatePositions(trace, kernel, base, mineral);
    }

    this.threadProduceEvents(trace, kernel, base, mineral);
    this.threadUpdateDropoff(trace, kernel, base, mineral);
    this.threadRequestHarvesters(trace, kernel, base, mineral);
    this.threadBuildExtractor(trace, kernel, base, mineral);

    trace.end();

    let sleepFor = 100;
    if (mineral.mineralAmount === 0) {
      sleepFor = mineral.ticksToRegeneration;
    }

    return sleeping(sleepFor);
  }

  produceEvents(trace: Tracer, kernel: Kernel, base: Base, mineral: Mineral) {
    const creepPosition = this.creepPosition;
    if (!creepPosition) {
      trace.error('no creep position', {room: mineral.room.name});
      return;
    }

    const data: LogisticsEventData = {
      id: mineral.id,
      position: creepPosition,
    };

    kernel.getBroker().getStream(getLogisticsTopic(base.id)).
      publish(new Event(this.id, Game.time, LogisticsEventType.RequestRoad, data));

    const hudLine: HudLine = {
      key: `${this.id}`,
      room: mineral.room.name,
      text: `mineral(${mineral.id}) - `,
      time: Game.time,
      order: 4,
    };

    kernel.getBroker().getStream(getLinesStream()).publish(new Event(this.id, Game.time,
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

    const [pathResult, details] = getPath(kernel, mineral.pos, colonyPos, roadPolicy, trace);
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

  updateDropoff(trace: Tracer, kernel: Kernel, base: Base, mineral: Mineral) {
    this.dropoffId = getStructureForResource(base, RESOURCE_ENERGY)?.id;
  }

  requestHarvesters(trace: Tracer, kernel: Kernel, base: Base, mineral: Mineral) {
    if (mineral.mineralAmount === 0) {
      trace.log('no minerals to harvest');
      return;
    }

    if (!this.creepPosition) {
      trace.error('creep position not set', {creepPosition: this.creepPosition});
      return;
    }

    if (!mineral.room) {
      trace.error('mineral room not visible', {room: mineral.room?.name});
      return;
    }

    const room = mineral.room;

    const username = kernel.getPlanner().getUsername();
    if (room?.controller?.owner && room.controller.owner.username !== username) {
      trace.log('room owned by someone else', {roomId: room.name, owner: room.controller?.owner?.username});
      return;
    }

    const baseCreeps = kernel.getCreepsManager().getCreepsByBase(base.id);
    const numHarvesters = baseCreeps.filter((creep) => {
      const role = creep.memory[MEMORY.MEMORY_ROLE];
      return role === WORKER_HARVESTER &&
        creep.memory[MEMORY.MEMORY_SOURCE] === this.id &&
        creepIsFresh(creep);
    }).length;

    trace.log('num harvesters', {numHarvesters});

    if (numHarvesters < 1) {
      const positionStr = [this.creepPosition.x, this.creepPosition.y, this.creepPosition.roomName].join(',');

      const memory = {
        [MEMORY.MEMORY_SOURCE]: this.id,
        [MEMORY.MEMORY_SOURCE_POSITION]: positionStr,
        [MEMORY.MEMORY_ASSIGN_ROOM]: mineral.room.name,
        [MEMORY.MEMORY_BASE]: base.id,
      };

      trace.log('requesting harvester', {mineralId: this.id, memory});

      const request = createSpawnRequest(PRIORITY_MINER, REQUEST_WORKER_TTL, WORKER_HARVESTER, memory, 0);
      kernel.getTopics().addRequestV2(getBaseSpawnTopic(base.id), request);
    }
  }

  buildExtractor(trace: Tracer, kernel: Kernel, base: Base, mineral: Mineral) {
    if (mineral.room.controller?.level < 6) {
      trace.log('room too low for extractor', {id: this.id});
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
        mineral.room.createConstructionSite(mineral.pos, STRUCTURE_EXTRACTOR);

        trace.warn('building extractor', {id: this.id});
      }
    }
  }
}
