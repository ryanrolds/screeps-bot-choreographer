import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {thread, ThreadFunc} from './os.thread';
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"
import * as CREEPS from "./constants.creeps"
import * as PRIORITIES from "./constants.priorities"

const CONSTRUCTION_INTERVAL = 50;

type BaseLayout = {
  origin: {x: number, y: number};
  parking: {x: number, y: number};
  buildings: string[][];
}

const layouts: BaseLayout[] = [
  {
    origin: {x: 0, y: 0},
    parking: {x: 0, y: 0},
    buildings: []
  },
  {
    origin: {x: 0, y: 4},
    parking: {x: 0, y: 4},
    buildings: [
      ['P'],
      [' '],
      [' '],
      [' '],
      [' '],
    ]
  },
  {
    origin: {x: 2, y: 5},
    parking: {x: 2, y: 6},
    buildings: [
      [' ', ' ', 'R', 'E', ' '],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      [' ', 'R', 'C', 'R', ' '],
      [' ', ' ', 'R', ' ', ' '],
      [' ', 'R', ' ', 'R', ' '],
      [' ', ' ', 'R', ' ', ' '],
    ]
  },
  {
    origin: {x: 2, y: 5},
    parking: {x: 5, y: 7},
    buildings: [
      [' ', 'E', 'R', 'E', ' '],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['R', 'T', 'R', 'E', 'R'],
      [' ', 'R', ' ', 'R', ' '],
      [' ', 'E', 'R', ' ', ' '],
    ]
  },
  {
    origin: {x: 3, y: 6},
    parking: {x: 6, y: 9},
    buildings: [
      [' ', 'E', 'R', 'E', 'R', 'E', ' '],
      [' ', 'R', 'E', 'R', 'E', 'R', 'R'],
      [' ', 'E', 'R', 'P', 'R', 'E', ' '],
      [' ', 'E', 'R', 'C', 'R', 'E', ' '],
      [' ', ' ', 'R', 'C', 'R', 'E', ' '],
      [' ', 'R', 'T', 'R', 'E', 'R', ' '],
      ['R', ' ', 'R', 'S', 'R', ' ', 'R'],
      [' ', 'R', 'E', 'R', 'E', 'R', ' '],
      [' ', ' ', 'R', ' ', 'R', 'R', 'R'],
      [' ', 'E', 'R', 'E', 'R', 'R', ' '],
      [' ', 'E', 'R', ' ', 'R', 'R', 'R'],
      [' ', 'R', 'E', 'R', 'E', 'R', ' '],
      [' ', 'E', 'R', 'E', 'R', ' ', ' '],
    ]
  },
]

const buildingCodes = {
  ' ': null,
  'R': STRUCTURE_ROAD,
  'P': STRUCTURE_SPAWN,
  'E': STRUCTURE_EXTENSION,
  'C': STRUCTURE_CONTAINER,
  'T': STRUCTURE_TOWER,
  'S': STRUCTURE_STORAGE,
}

export default class BaseConstructionRunnable {
  id: string;
  orgRoom: OrgRoom;

  constructor(id: string, orgRoom: OrgRoom) {
    this.id = id;
    this.orgRoom = orgRoom;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id).begin('base_construction_run');

    const roomLevel = this.orgRoom.getRoomLevel();
    if (roomLevel < 1) {
      trace.notice('room level low', {roomLevel});
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const colony = this.orgRoom.getColony();
    if (!colony) {
      trace.end();
      return sleeping(50);
    }

    const isAutomated = colony.isAutomated();
    if (!isAutomated) {
      trace.notice('not automated');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const origin = colony.getOrigin();
    if (!origin) {
      trace.notice('no origin');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const layout = layouts.find((layout, level) => {
      // Dont try to build a layout if we are not at the right level
      if (roomLevel < level) {
        trace.log('room level too low', {roomLevel, level});
        return false;
      }

      // Dont build a layout that is already done
      if (this.layoutComplete(layout, room, origin, trace)) {
        trace.log('layout complete', {level, layout});
        return false;
      }

      trace.log('layout not done', {level, layout});
      return true;
    });

    if (!layout) {
      trace.log('no layout');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    this.buildLayout(layout, room, origin, trace);

    trace.end();
    return sleeping(CONSTRUCTION_INTERVAL);
  }

  buildLayout(layout: BaseLayout, room: Room, origin: RoomPosition, trace: Tracer): void {
    trace.notice('building layout', {roomId: room.name, layout});

    const roomVisual = new RoomVisual(room.name);
    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const code = row[x];
        if (code === ' ') {
          trace.log('empty spot', {x, y});
          continue;
        }

        const pos = getConstructionPosition({x, y}, origin, layout);
        const structure = pos.lookFor(LOOK_STRUCTURES)[0];
        if (structure) {
          // TODO check type and destroy if wrong
          trace.log('structure present', {structure: structure.structureType});
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
        if (!structureType) {
          continue;
        }

        // roomVisual.text(code, pos.x, pos.y);

        const result = room.createConstructionSite(pos, structureType);
        if (result !== OK) {
          trace.error('failed to build structure', {structureType, pos, result});
        }
      }
    }
  }

  layoutComplete(layout: BaseLayout, room: Room, origin: RoomPosition, trace: Tracer): boolean {
    if (layout.buildings.length === 0) {
      trace.log('nothing to build', {layout});
      return true;
    }

    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const pos = getConstructionPosition({x, y}, origin, layout);
        const structures = pos.lookFor(LOOK_STRUCTURES);

        const code = row[x];
        if (code === ' ') {
          continue;
        }

        if (!structures.length || structures[0].structureType !== buildingCodes[code]) {
          trace.log('missing structure', {pos, structures: structures.map(s => s.structureType)});
          return false;
        }
      }
    }

    trace.log('layout complete', {layout});
    return true;
  }
}

const getConstructionPosition = (pos: {x: number, y: number}, origin: RoomPosition, layout: BaseLayout): RoomPosition => {
  return new RoomPosition(pos.x + origin.x - layout.origin.x, pos.y + origin.y - layout.origin.y, origin.roomName);
}
