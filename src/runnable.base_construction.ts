import {RunnableResult, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import OrgRoom from "./org.room";

const CONSTRUCTION_INTERVAL = 50;

type BaseLayout = {
  origin: {x: number, y: number};
  parking: {x: number, y: number};
  buildings: string[][];
}

const layouts: BaseLayout[] = [
  { // RCL0
    origin: {x: 0, y: 0},
    parking: {x: 0, y: 0},
    buildings: []
  },
  { // RCL1
    origin: {x: 0, y: 4},
    parking: {x: 0, y: 4},
    buildings: [
      ['P'],
      ['X'],
      ['X'],
      ['X'],
      ['X'],
    ]
  },
  { // RCL2
    origin: {x: 2, y: 5},
    parking: {x: 2, y: 6},
    buildings: [
      ['.', '.', 'R', 'E', '.'],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['X', 'R', 'C', 'R', 'X'],
      ['R', 'X', 'R', 'X', 'R'],
      ['.', 'R', 'X', 'R', '.'],
      ['.', '.', 'R', '.', '.'],
    ]
  },
  { // RCL3
    origin: {x: 2, y: 5},
    parking: {x: 5, y: 7},
    buildings: [
      ['.', 'E', 'R', 'E', '.'],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['E', 'R', 'C', 'R', 'E'],
      ['R', 'T', 'R', 'E', 'R'],
      ['.', 'R', 'X', 'R', '.'],
      ['.', 'E', 'R', 'X', '.'],
    ]
  },
  { // RCL4
    origin: {x: 3, y: 6},
    parking: {x: 6, y: 9},
    buildings: [
      ['X', 'E', 'R', 'E', 'R', 'E', 'X'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R'],
      ['X', 'E', 'R', 'P', 'R', 'E', 'X'],
      ['X', 'E', 'R', 'C', 'R', 'E', 'X'],
      ['X', 'X', 'R', 'C', 'R', 'E', 'X'],
      ['X', 'R', 'T', 'R', 'E', 'R', 'X'],
      ['R', 'X', 'R', 'S', 'R', 'X', 'R'],
      ['X', 'R', 'E', 'R', 'E', 'R', 'X'],
      ['X', 'X', 'R', 'X', 'R', 'R', 'R'],
      ['X', 'E', 'R', 'E', 'R', 'R', ' '],
      ['X', 'E', 'R', 'X', 'R', 'R', 'R'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R'],
      ['X', 'E', 'R', 'E', 'R', 'X', 'X'],
    ]
  },
  { // RCL5
    origin: {x: 3, y: 6},
    parking: {x: 6, y: 10},
    buildings: [
      ['E', 'E', 'R', 'E', 'R', 'E', 'E'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R'],
      ['E', 'E', 'R', 'P', 'R', 'E', 'E'],
      ['E', 'E', 'R', 'E', 'R', 'E', 'E'],
      ['X', 'X', 'R', 'X', 'R', 'X', 'X'],
      ['X', 'R', 'T', 'R', 'E', 'R', 'X'],
      ['R', 'X', 'R', 'S', 'R', 'L', 'R'],
      ['X', 'R', 'E', 'R', 'T', 'R', 'X'],
      ['X', 'X', 'R', 'X', 'R', 'R', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'R', ' '],
      ['E', 'E', 'R', 'X', 'R', 'R', 'R'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'E', 'E'],
    ]
  },
  { // RCL6
    origin: {x: 6, y: 7},
    parking: {x: 9, y: 10},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', '.', '.'],
      ['.', '.', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', '.', '.'],
      ['.', '.', 'E', 'B', 'B', 'R', 'X', 'R', 'X', 'X', 'E', '.', '.'],
      ['.', '.', 'R', 'B', 'R', 'T', 'R', 'E', 'R', 'X', 'R', '.', '.'],
      ['.', '.', '.', 'R', 'M', 'R', 'S', 'R', 'L', 'R', '.', '.', '.'],
      ['.', '.', 'R', 'X', 'R', 'E', 'R', 'T', 'R', 'X', 'R', '.', '.'],
      ['.', '.', 'E', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', '.', '.'],
      ['.', '.', 'E', 'E', 'E', 'R', 'E', 'R', 'R', ' ', 'R', '.', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'X', 'R', 'R', 'R', 'R', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ]
  },
  { // RCL7
    origin: {x: 6, y: 7},
    parking: {x: 9, y: 10},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', 'E', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', '.'],
      ['.', 'R', 'E', 'B', 'B', 'R', 'X', 'R', 'B', 'B', 'E', 'R', '.'],
      ['.', 'E', 'R', 'B', 'R', 'T', 'R', 'X', 'R', 'B', 'R', 'E', '.'],
      ['.', 'R', 'E', 'R', 'M', 'R', 'S', 'R', 'L', 'R', 'E', 'R', '.'],
      ['.', 'E', 'R', 'X', 'R', 'T', 'R', 'T', 'R', 'E', 'R', 'E', '.'],
      ['.', 'R', 'E', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'R', ' ', 'R', 'R', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'R', 'R', 'R', 'E', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ]
  },
  { // RCL8
    origin: {x: 6, y: 7},
    parking: {x: 9, y: 10},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'O', 'R', 'E', 'E', '.', '.', '.'],
      ['.', 'E', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', 'E', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', 'E', '.'],
      ['E', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', 'E'],
      ['E', 'R', 'E', 'B', 'B', 'R', 'T', 'R', 'B', 'B', 'E', 'R', 'E'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'T', 'R', 'B', 'R', 'E', 'R'],
      ['E', 'R', 'E', 'R', 'M', 'R', 'S', 'R', 'L', 'R', 'P', 'R', 'E'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'T', 'R', ' ', 'R', 'E', 'R'],
      ['E', 'R', 'E', 'B', 'B', 'R', 'T', 'R', 'R', 'R', 'R', 'R', 'E'],
      ['E', 'R', 'E', 'E', 'N', 'R', 'E', 'R', 'R', 'K', 'R', 'R', 'E'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'R', 'R', 'R', 'E', '.'],
      ['.', 'E', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', 'E', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ]
  },
]

const EMPTY = 'empty';
const ANY = 'any';
const PARKING = 'parking';

const buildingCodes = {
  'X': EMPTY,
  '.': ANY,
  'R': STRUCTURE_ROAD,
  'P': STRUCTURE_SPAWN,
  'E': STRUCTURE_EXTENSION,
  'C': STRUCTURE_CONTAINER,
  'T': STRUCTURE_TOWER,
  'S': STRUCTURE_STORAGE,
  'L': STRUCTURE_LINK,
  'M': STRUCTURE_TERMINAL,
  'B': STRUCTURE_LAB,
  'O': STRUCTURE_OBSERVER,
  'N': STRUCTURE_NUKER,
}

export default class BaseConstructionRunnable {
  id: string;
  orgRoom: OrgRoom;

  constructor(id: string, orgRoom: OrgRoom) {
    this.id = id;
    this.orgRoom = orgRoom;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('base_construction_run');

    const roomLevel = this.orgRoom.getRoomLevel();
    if (roomLevel < 1) {
      trace.log('room level low', {roomLevel});
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
      trace.log('not automated');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const origin = colony.getOrigin();
    if (!origin) {
      trace.log('no origin');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const room = this.orgRoom.getRoomObject();
    if (!room) {
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const layout = this.selectLayout(roomLevel, room, origin, trace);
    if (!layout) {
      trace.log('no layout');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    this.buildLayout(kingdom, layout, room, origin, trace);

    trace.end();
    return sleeping(CONSTRUCTION_INTERVAL);
  }

  selectLayout(roomLevel: number, room: Room, origin: RoomPosition, trace: Tracer): BaseLayout {
    const layout = layouts[roomLevel];

    // Dont build a layout that is already done
    if (this.layoutComplete(layout, room, origin, trace)) {
      trace.log('layout complete', {roomLevel, layout});
      return null;
    }

    return layout;
  }

  buildLayout(kingdrom: Kingdom, layout: BaseLayout, room: Room, origin: RoomPosition, trace: Tracer): void {
    trace.log('building layout', {roomId: room.name, layout});

    const roomVisual = new RoomVisual(room.name);
    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const code = row[x];
        if (buildingCodes[code] === ANY) {
          continue;
        }

        const pos = getConstructionPosition({x, y}, origin, layout);

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
