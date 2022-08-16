import {controllerRoadPolicy} from '../constants/pathing_policies';
import {Event} from '../lib/event_broker';
import {ANY, buildingCodes, EMPTY, getConstructionPosition, Layout} from '../lib/layouts';
import {getPath} from '../lib/pathing';
import {Tracer} from '../lib/tracing';
import {AlertLevel, Base, BaseThreadFunc, threadBase} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {PersistentMemory} from '../os/memory';
import {Runnable, RunnableResult, sleeping} from '../os/process';
import {getLogisticsTopic, LogisticsEventData, LogisticsEventType} from './logistics';

const RUN_TTL = 50;
const BUILD_STRUCTURES_TTL = 200;
const PRODUCE_EVENTS_TTL = 50;

const padLayout: Map<DirectionConstant, Layout> = new Map();
padLayout.set(TOP, {
  origin: {x: 1, y: 1},
  buildings: [
    ['R', 'R', 'R'],
    ['.', 'L', '.'],
    ['.', '.', '.'],
  ],
});
padLayout.set(TOP_RIGHT, {
  origin: {x: 1, y: 1},
  buildings: [
    ['.', 'R', 'R'],
    ['.', 'L', 'R'],
    ['.', '.', '.'],
  ],
});
padLayout.set(RIGHT, {
  origin: {x: 1, y: 1},
  buildings: [
    ['.', '.', 'R'],
    ['.', 'L', 'R'],
    ['.', '.', 'R'],
  ],
});
padLayout.set(BOTTOM_RIGHT, {
  origin: {x: 1, y: 1},
  buildings: [
    ['.', '.', '.'],
    ['.', 'L', 'R'],
    ['.', 'R', 'R'],
  ],
});
padLayout.set(BOTTOM, {
  origin: {x: 1, y: 1},
  buildings: [
    ['.', '.', '.'],
    ['.', 'L', '.'],
    ['R', 'R', 'R'],
  ],
});
padLayout.set(BOTTOM_LEFT, {
  origin: {x: 1, y: 1},
  buildings: [
    ['.', '.', '.'],
    ['R', 'L', '.'],
    ['R', 'R', '.'],
  ],
});
padLayout.set(LEFT, {
  origin: {x: 1, y: 1},
  buildings: [
    ['R', '.', '.'],
    ['R', 'L', '.'],
    ['R', '.', '.'],
  ],
});
padLayout.set(TOP_LEFT, {
  origin: {x: 1, y: 1},
  buildings: [
    ['R', 'R', '.'],
    ['R', 'L', '.'],
    ['.', '.', '.'],
  ],
});


export default class ControllerRunnable extends PersistentMemory implements Runnable {
  controllerId: string;

  nodePosition: RoomPosition;
  nodeDirection: DirectionConstant;
  roadPosition: RoomPosition;

  threadProduceEvents: BaseThreadFunc;
  threadBuildStructures: BaseThreadFunc;

  constructor(controllerId: string) {
    super(controllerId);

    this.controllerId = controllerId;

    this.threadBuildStructures = threadBase('check_structures', BUILD_STRUCTURES_TTL)(this.buildStructures.bind(this));
    this.threadProduceEvents = threadBase('consume_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.as('controller_run');
    trace.info('run', {
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

    const base = kernel.getPlanner().getBaseByRoom(controller.room.name);
    if (!base) {
      trace.error('missing origin', {id: controller.room.name});
      return sleeping(RUN_TTL);
    }

    if (!this.nodePosition || !this.nodeDirection) {
      trace.info('node and road position not set, populating');
      this.populateNodePosition(kernel, controller, trace);
    }

    if (base.alertLevel === AlertLevel.GREEN) {
      this.threadBuildStructures(trace, kernel, base, controller.room);
      this.threadProduceEvents(trace, kernel, base, controller);
    }

    return sleeping(RUN_TTL);
  }

  populateNodePosition(kernel: Kernel, controller: StructureController, trace: Tracer) {
    const memory = this.getMemory(trace) || {};

    if (memory.nodePosition && memory.roadPosition) {
      this.nodePosition = new RoomPosition(memory.nodePosition.x, memory.nodePosition.y, memory.nodePosition.roomName);
      this.roadPosition = new RoomPosition(memory.roadPosition.x, memory.roadPosition.y, memory.roadPosition.roomName);
      this.nodeDirection = controller.pos.getDirectionTo(this.roadPosition);
      trace.info('populated node position from memory', {
        nodePosition: this.nodePosition,
        roadPosition: this.roadPosition,
        nodeDirection: this.nodeDirection,
      });
    }

    if (this.nodePosition && this.roadPosition) {
      trace.info('node and road positions are already set');
      return;
    }

    const base = kernel.getPlanner().getBaseByRoom(controller.pos.roomName);
    if (!base) {
      trace.error('missing base config', {room: controller.pos.roomName});
      return;
    }

    const [pathResult, details] = getPath(kernel, base.origin, controller.pos, controllerRoadPolicy, trace);
    if (!pathResult || !pathResult.path.length) {
      trace.error('no path found', {origin: base.origin, dest: controller.pos, pathResult, details});
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
      direction: this.nodeDirection,
    });

    memory.nodePosition = this.nodePosition;
    memory.roadPosition = this.roadPosition;

    this.setMemory(memory, false);
  }

  produceEvents(trace: Tracer, kernel: Kernel, base: Base, controller: StructureController) {
    const position = this.roadPosition;
    if (!position) {
      trace.error('no road position', {room: controller.room.name});
      return;
    }

    // If there is not a link, build a road to the controller
    const link = controller.pos.findInRange(FIND_MY_STRUCTURES, 1, {filter: (s) => s.structureType === STRUCTURE_LINK})[0];
    if (!link) {
      const data: LogisticsEventData = {
        id: controller.id,
        position: position,
      };

      kernel.getBroker().getStream(getLogisticsTopic(base.id)).
        publish(new Event(this.controllerId, Game.time, LogisticsEventType.RequestRoad, data));
    }
  }

  buildStructures(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    trace.info('building structures for controller', {controllerId: this.controllerId});

    if (!this.nodePosition || !this.nodeDirection) {
      trace.error('missing node position or direction', {
        id: this.controllerId,
        nodePosition: this.nodePosition,
        nodeDirection: this.nodeDirection,
      });
      return;
    }

    const layout = padLayout.get(this.nodeDirection);
    const terrain = room.getTerrain();

    trace.info('building structures', {layout});

    const roomVisual = new RoomVisual(room.name);
    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const code = row[x];

        const pos = getConstructionPosition({x, y}, this.nodePosition, layout);
        trace.info('building structure', {code, pos});


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
        trace.info('structure', {structure, pos});

        if (structure) {
          trace.info('structure present', {structure: structure.structureType});

          if (structure.structureType !== buildingCodes[code]) {
            trace.warn('wrong site, remove', {existing: structure.structureType, expected: buildingCodes[code]});
            structure.destroy();
          }

          continue;
        }

        const site = pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
        trace.info('site', {site});
        if (site) {
          if (site.structureType !== buildingCodes[code]) {
            trace.warn('wrong site, remove', {existing: site.structureType, expected: buildingCodes[code]});
            site.remove();
          }

          continue;
        }

        const structureType = buildingCodes[code];
        if (!structureType || structureType === EMPTY) {
          trace.info('no structure type', {code, x, y});
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
