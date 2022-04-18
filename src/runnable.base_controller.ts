import {Event} from "./lib.event_broker";
import {ANY, buildingCodes, EMPTY, getConstructionPosition, Layout} from "./lib.layouts";
import {getPath} from "./lib.pathing";
import {controllerRoadPolicy} from "./constants.pathing_policies";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {PersistentMemory} from "./os.memory";
import {sleeping} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getLogisticsTopic, LogisticsEventData, LogisticsEventType} from "./runnable.base_logistics";

const RUN_TTL = 100;
const BUILD_STRUCTURES_TTL = 1000;
const PRODUCE_EVENTS_TTL = 500;

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

export default class ControllerRunnable extends PersistentMemory implements Runnable {
  controllerId: string;

  nodePosition: RoomPosition;
  nodeDirection: DirectionConstant;
  roadPosition: RoomPosition;

  threadProduceEvents: ThreadFunc;
  threadBuildStructures: ThreadFunc;

  constructor(controllerId: string) {
    super(controllerId);

    this.controllerId = controllerId;

    this.threadBuildStructures = thread('check_structures', BUILD_STRUCTURES_TTL)(this.buildStructures.bind(this));
    this.threadProduceEvents = thread('consume_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.as('controller_run');
    trace.log('run', {
      controller: this.controllerId,
      nodePosition: this.nodePosition,
      roadPosition: this.roadPosition,
      nodeDirection: this.nodeDirection,
    });

    const controller = Game.getObjectById(this.controllerId as Id<StructureController>);
    if (!controller) {
      trace.error('missing controller', {id: this.controllerId});
      return sleeping(RUN_TTL);
    }

    if (!this.nodePosition || !this.nodeDirection) {
      trace.log('node and road position not set, populating');
      this.populateNodePosition(kingdom, controller, trace);
    }

    this.threadBuildStructures(trace, controller.room);
    this.threadProduceEvents(trace, kingdom, controller);

    return sleeping(RUN_TTL);
  }

  populateNodePosition(kingdom: Kingdom, controller: StructureController, trace: Tracer) {
    const memory = this.getMemory(trace) || {};

    if (memory.nodePosition && memory.roadPosition) {
      this.nodePosition = new RoomPosition(memory.nodePosition.x, memory.nodePosition.y, memory.nodePosition.roomName);
      this.roadPosition = new RoomPosition(memory.roadPosition.x, memory.roadPosition.y, memory.roadPosition.roomName);
      this.nodeDirection = controller.pos.getDirectionTo(this.roadPosition)
      trace.log('populated node position from memory', {
        nodePosition: this.nodePosition,
        roadPosition: this.roadPosition,
        nodeDirection: this.nodeDirection
      });
    }

    if (this.nodePosition && this.roadPosition) {
      trace.log('node and road positions are already set');
      return;
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(controller.pos.roomName)
    if (!baseConfig) {
      trace.error('missing colony config', {room: controller.pos.roomName});
      return;
    }

    const [pathResult, details] = getPath(kingdom, baseConfig.origin, controller.pos, controllerRoadPolicy, trace);
    trace.log('path result', {origin: baseConfig.origin, dest: controller.pos, pathResult});

    if (!pathResult || !pathResult.path.length) {
      trace.error('no path found', {origin: baseConfig.origin, dest: controller.pos, pathResult});
      return;
    }

    // We are grabbing where we will put a link
    const pathLength = pathResult.path.length;
    this.nodePosition = pathResult.path[pathLength - 1];
    this.roadPosition = pathResult.path[pathLength - 2];
    this.nodeDirection = controller.pos.getDirectionTo(this.roadPosition);

    trace.warn('node and road position was not set: setting', {
      id: this.controllerId,
      position: this.nodePosition,
      direction: this.nodeDirection
    });

    memory.nodePosition = this.nodePosition;
    memory.roadPosition = this.roadPosition;

    this.setMemory(memory, false);
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
    const terrain = room.getTerrain();

    trace.log('building structures', {layout})

    const roomVisual = new RoomVisual(room.name);
    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const code = row[x];

        const pos = getConstructionPosition({x, y}, this.nodePosition, layout);
        trace.log('building structure', {code, pos});


        if (buildingCodes[code] === ANY) {
          continue;
        }

        // We cant build links until RCL5
        if (code === 'L' && room.controller.level < 5) {
          continue;
        }

        if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
          continue;
        }

        const structure = pos.lookFor(LOOK_STRUCTURES)[0];
        trace.log('structure', {structure, pos});

        if (structure) {
          trace.log('structure present', {structure: structure.structureType});

          if (structure.structureType !== buildingCodes[code]) {
            trace.warn('wrong site, remove', {existing: structure.structureType, expected: buildingCodes[code]});
            structure.destroy();
          }

          continue;
        }

        const site = pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
        trace.log('site', {site});
        if (site) {
          if (site.structureType !== buildingCodes[code]) {
            trace.warn('wrong site, remove', {existing: site.structureType, expected: buildingCodes[code]});
            site.remove();
          }

          continue;
        }

        const structureType = buildingCodes[code];
        if (!structureType || structureType === EMPTY) {
          trace.log('no structure type', {code, x, y});
          continue;
        }

        roomVisual.text(code, pos.x, pos.y);

        const result = room.createConstructionSite(pos, structureType);
        if (result !== OK && result !== ERR_FULL) {
          trace.error('failed to build structure', {structureType, pos, result});
          return;
        }

        trace.notice('building structure', {pos, structureType});
      }
    }
  }
}
