import {Event} from "./lib.event_broker";
import {ANY, buildingCodes, EMPTY, getConstructionPosition, Layout} from "./lib.layouts";
import {getPath} from "./lib.pathing";
import {roadPolicy} from "./lib.pathing_policies";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from "./os.thread";
import {getLogisticsTopic, LogisticsEventData, LogisticsEventType} from "./runnable.base_logistics";

const RUN_TTL = 20;
const CALCULATE_NODE_TTL = 5000;
const BUILD_STRUCTURES_TTL = 20;
const PRODUCE_EVENTS_TTL = 20;

const padLayout: Record<DirectionConstant, Layout> = {
  [TOP]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['R', 'R', 'R'],
      ['.', 'L', '.'],
      ['.', '.', '.'],
    ]
  },
  [TOP_RIGHT]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['.', 'R', 'R'],
      ['.', 'L', 'R'],
      ['.', '.', '.'],
    ]
  },
  [RIGHT]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['.', '.', 'R'],
      ['.', 'L', 'R'],
      ['.', '.', 'R'],
    ]
  },
  [BOTTOM_RIGHT]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['.', '.', '.'],
      ['.', 'L', 'R'],
      ['.', 'R', 'R'],
    ]
  },
  [BOTTOM]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['.', '.', '.'],
      ['.', 'L', '.'],
      ['R', 'R', 'R'],
    ]
  },
  [BOTTOM_LEFT]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['.', '.', '.'],
      ['R', 'L', '.'],
      ['R', 'R', '.'],
    ]
  },
  [LEFT]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['R', '.', '.'],
      ['R', 'L', '.'],
      ['R', '.', '.'],
    ]
  },
  [TOP_LEFT]: {
    origin: {x: 1, y: 1},
    buildings: [
      ['R', 'R', '.'],
      ['R', 'L', '.'],
      ['.', '.', '.'],
    ]
  },
};

export default class ControllerRunnable {
  controllerId: string;
  scheduler: Scheduler;
  nodePosition: RoomPosition;
  roadPosition: RoomPosition;;
  nodeDirection: DirectionConstant;

  threadProduceEvents: ThreadFunc;
  threadCalculateNode: ThreadFunc;
  threadBuildStructures: ThreadFunc;

  constructor(controllerId: string) {
    this.controllerId = controllerId;

    this.threadCalculateNode = thread('calculate_node', CALCULATE_NODE_TTL)(this.calculateNode.bind(this));
    this.threadBuildStructures = thread('check_structures', BUILD_STRUCTURES_TTL)(this.buildStructures.bind(this));
    this.threadProduceEvents = thread('consume_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.as('controller_run');

    const controller = Game.getObjectById(this.controllerId as Id<StructureController>);
    if (!controller) {
      trace.error('missing controller', {id: this.controllerId});
      return sleeping(RUN_TTL);
    }


    this.threadProduceEvents(trace, kingdom, controller);
    this.threadCalculateNode(trace, kingdom);
    this.threadBuildStructures(trace, controller.room);

    return sleeping(RUN_TTL);
  }


  produceEvents(trace: Tracer, kingdom: Kingdom, controller: StructureController) {
    const position = this.roadPosition;
    if (!position) {
      trace.error('no road position', {room: controller.room.name});
      return;
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(controller.room.name);
    if (!baseConfig) {
      trace.error('no colony config', {room: controller.room.name});
      return;
    }

    const data: LogisticsEventData = {
      id: controller.id,
      position: position,
    };

    kingdom.getBroker().getStream(getLogisticsTopic(baseConfig.id)).
      publish(new Event(this.controllerId, Game.time, LogisticsEventType.RequestRoad, data));
  }

  calculateNode(trace: Tracer, kingdom: Kingdom) {
    if (this.nodePosition && this.nodeDirection) {
      return;
    }

    const controller = Game.getObjectById(this.controllerId as Id<StructureController>);
    if (!controller) {
      trace.error('missing controller', {id: this.controllerId});
      return;
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(controller.pos.roomName)
    if (!baseConfig) {
      trace.error('missing colony config', {room: controller.pos.roomName});
      return;
    }

    const [pathResult, details] = getPath(kingdom, controller.pos, baseConfig.origin, roadPolicy, trace);
    trace.log('path result', {origin: baseConfig.origin, dest: controller.pos, pathResult});

    if (!pathResult || !pathResult.path.length) {
      trace.error('no path found', {origin: baseConfig.origin, dest: controller.pos, pathResult});
      return;
    }

    // We are grabbing where we will put a link
    this.nodePosition = pathResult.path[1];
    this.roadPosition = pathResult.path[2];
    this.nodeDirection = controller.pos.getDirectionTo(pathResult.path[2]);

    trace.log('node position', {
      id: this.controllerId,
      position: this.nodePosition,
      direction: this.nodeDirection
    });
  }

  buildStructures(trace: Tracer, room: Room) {
    trace.log('building structures for controller', {controllerId: this.controllerId});

    if (!this.nodePosition || !this.nodeDirection) {
      trace.error('missing node position or direction', {
        id: this.controllerId,
        nodePosition: this.nodePosition,
        nodeDirection: this.nodeDirection
      });
      return;
    }

    const layout = padLayout[this.nodeDirection];

    // const roomVisual = new RoomVisual(room.name);
    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const code = row[x];
        if (buildingCodes[code] === ANY) {
          continue;
        }

        // We cant build links until RCL5
        if (code === 'L' && room.controller.level < 5) {
          continue;
        }

        const pos = getConstructionPosition({x, y}, this.nodePosition, layout);
        const structure = pos.lookFor(LOOK_STRUCTURES)[0];
        if (structure) {
          trace.log('structure present', {structure: structure.structureType});

          if (structure.structureType !== buildingCodes[code]) {
            trace.log('wrong site, remove', {existing: structure.structureType, expected: buildingCodes[code]});
            structure.destroy();
          }

          continue;
        }

        const site = pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
        if (site) {
          if (site.structureType !== buildingCodes[code]) {
            trace.log('wrong site, remove', {existing: site.structureType, expected: buildingCodes[code]});
            site.remove();
          }

          continue;
        }

        const structureType = buildingCodes[code];
        if (!structureType || structureType === EMPTY) {
          continue;
        }

        // roomVisual.text(code, pos.x, pos.y);

        const result = room.createConstructionSite(pos, structureType);
        if (result !== OK && result !== ERR_FULL) {
          trace.error('failed to build structure', {structureType, pos, result});
        }
      }
    }
  }
}
