import {Base, getBaseLevel, getBasePrimaryRoom, setParking} from './base';
import {Kernel} from './kernel';
import {PossibleSite, prioritizeBySitesType} from './lib.construction';
import {ANY, buildingCodes, EMPTY, getConstructionPosition} from './lib.layouts';
import {Tracer} from './lib.tracing';
import {sleeping, terminate} from './os.process';
import {RunnableResult} from './os.runnable';

const CONSTRUCTION_INTERVAL = 100;
const MAX_WALL_SITES = 5;
const MAX_STRUCTURE_SITES = 5;

export type BaseLayout = {
  origin: {x: number, y: number};
  parking: {x: number, y: number};
  buildings: string[][];
}

export const baseLayouts: BaseLayout[] = [
  { // RCL0
    origin: {x: 0, y: 0},
    parking: {x: 0, y: 0},
    buildings: [],
  },
  { // RCL1
    origin: {x: 0, y: 4},
    parking: {x: 0, y: 0},
    buildings: [
      ['P'],
      ['.'],
      ['.'],
      ['.'],
      ['.'],
    ],
  },
  { // RCL2
    origin: {x: 2, y: 5},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', 'E', 'R', 'E', '.'],
      ['.', 'R', 'P', 'R', '.'],
      ['.', 'R', 'E', 'R', '.'],
      ['.', 'R', 'E', 'R', '.'],
      ['.', 'X', 'R', 'E', '.'],
      ['.', 'R', 'X', 'R', '.'],
      ['.', 'X', 'R', 'X', '.'],
    ],
  },
  { // RCL3
    origin: {x: 2, y: 5},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', 'E', 'R', 'E', '.'],
      ['E', 'R', 'P', 'R', 'E'],
      ['E', 'R', 'E', 'R', 'E'],
      ['.', 'R', 'E', 'R', '.'],
      ['.', 'T', 'R', 'E', '.'],
      ['.', 'R', 'X', 'R', '.'],
      ['.', '.', 'R', 'E', '.'],
    ],
  },
  { // RCL4
    origin: {x: 3, y: 6},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', 'R', 'E', 'R', '.', '.', '.'],
      ['.', 'R', 'E', 'R', 'E', 'R', 'R', '.'],
      ['.', 'E', 'R', 'P', 'R', 'E', '.', 'R'],
      ['.', 'E', 'R', 'E', 'R', 'E', '.', '.'],
      ['.', 'X', 'R', 'E', 'R', 'E', '.', '.'],
      ['.', 'R', 'T', 'R', 'E', 'R', '.', 'R'],
      ['R', 'X', 'R', 'S', 'R', 'X', 'R', '.'],
      ['.', 'R', 'E', 'R', 'E', 'R', 'X', 'R'],
      ['.', 'X', 'R', 'X', 'R', 'R', 'R', 'R'],
      ['.', 'E', 'R', 'E', 'R', 'R', 'X', 'R'],
      ['.', 'E', 'R', 'X', 'R', 'R', 'R', 'R'],
      ['.', 'R', 'E', 'R', 'E', 'R', 'R', 'R'],
      ['.', '.', 'R', 'E', 'R', 'E', '.', '.'],
    ],
  },
  { // RCL5
    origin: {x: 3, y: 6},
    parking: {x: 3, y: 3},
    buildings: [
      ['E', 'E', 'R', 'E', 'R', 'E', 'E', '.'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R', '.'],
      ['E', 'E', 'R', 'P', 'R', 'E', 'E', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'E', 'E', '.'],
      ['X', 'X', 'R', 'X', 'R', 'X', 'X', '.'],
      ['X', 'R', 'T', 'R', 'E', 'R', 'X', 'R'],
      ['R', 'X', 'R', 'S', 'R', 'L', 'R', '.'],
      ['X', 'R', 'E', 'R', 'T', 'R', '.', 'R'],
      ['X', 'X', 'R', 'X', 'R', 'R', 'R', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'R', 'X', 'R'],
      ['E', 'E', 'R', 'X', 'R', 'R', 'R', 'R'],
      ['R', 'R', 'E', 'R', 'E', 'R', 'R', 'R'],
      ['E', 'E', 'R', 'E', 'R', 'E', 'E', '.'],
    ],
  },
  { // RCL6
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', '.', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', '.'],
      ['.', 'R', 'E', 'B', 'B', 'R', 'X', 'R', 'X', 'X', 'E', 'R', '.'],
      ['.', '.', 'R', 'B', 'R', 'T', 'R', 'E', 'R', 'X', 'R', '.', '.'],
      ['.', '.', '.', 'R', 'M', 'R', 'S', 'R', 'L', 'R', '.', '.', '.'],
      ['.', '.', 'R', 'X', 'R', 'E', 'R', 'T', 'R', 'X', 'R', '.', '.'],
      ['.', 'R', 'E', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'R', 'X', 'R', 'R', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'R', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ],
  },
  { // RCL7
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', '.', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', 'E', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', '.'],
      ['.', 'R', 'E', 'B', 'B', 'R', 'X', 'R', 'B', 'B', 'E', 'R', '.'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'X', 'R', 'B', 'R', 'E', 'R'],
      ['.', 'R', 'E', 'R', 'M', 'R', 'S', 'R', 'L', 'R', 'E', 'R', '.'],
      ['R', 'E', 'R', 'X', 'R', 'T', 'R', 'T', 'R', 'E', 'R', 'E', 'R'],
      ['.', 'R', 'E', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'R', 'X', 'R', 'R', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', '.', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'R', 'E', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ],
  },
  { // RCL8
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'O', 'R', 'E', 'E', '.', '.', '.'],
      ['.', 'E', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'E', 'E', '.'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', 'E', '.'],
      ['E', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', 'R', 'E'],
      ['E', 'R', 'E', 'B', 'B', 'R', 'T', 'R', 'B', 'B', 'E', 'R', 'E'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'T', 'R', 'B', 'R', 'E', 'R'],
      ['E', 'R', 'E', 'R', 'M', 'R', 'S', 'R', 'L', 'R', 'P', 'R', 'E'],
      ['R', 'E', 'R', 'B', 'R', 'T', 'R', 'T', 'R', 'X', 'R', 'E', 'R'],
      ['E', 'R', 'E', 'B', 'B', 'R', 'T', 'R', 'R', 'R', 'R', 'R', 'E'],
      ['E', 'R', 'E', 'E', 'E', 'R', 'E', 'R', 'R', 'N', 'R', 'R', 'E'],
      ['.', 'E', 'R', 'E', 'E', 'R', 'P', 'R', 'R', 'R', 'R', 'R', 'E'],
      ['.', 'E', 'E', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'R', 'E', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', 'E', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ],
  },
];

export default class BaseConstructionRunnable {
  id: string;
  baseId: string;

  constructor(baseId: string, id: string) {
    this.id = id;
    this.baseId = baseId;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('base_construction_run');

    trace.info('base construction run', {id: this.id, baseId: this.baseId});

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('no base config');
      trace.end();
      return terminate();
    }

    const origin = base.origin;
    if (!origin) {
      trace.error('no origin');
      trace.end();
      return sleeping(CONSTRUCTION_INTERVAL);
    }

    const baseLevel = getBaseLevel(base);

    // Update parking lot for room level
    const levelLayout = baseLayouts[baseLevel];
    if (levelLayout) {
      setParking(base, levelLayout, origin);
    } else {
      trace.error('no level layout', {roomLevel: baseLevel});
    }

    // We have check all the things, now it's time to work out what we are building and build it
    const unfinished = this.selectLayout(baseLevel, origin, trace);
    if (unfinished) {
      this.buildLayout(base, unfinished, origin, trace);
    } else {
      trace.info('no unfinished layout', {roomLevel: baseLevel});
    }

    if (baseLevel >= 3) {
      this.buildWalls(kernel, base, trace);
    }

    trace.end();
    return sleeping(CONSTRUCTION_INTERVAL);
  }

  selectLayout(roomLevel: number, origin: RoomPosition, trace: Tracer): BaseLayout {
    // for (let i = 0; i <= roomLevel; i++) {
    //  const layout = baseLayouts[i];
    const layout = baseLayouts[roomLevel];
    if (!this.layoutComplete(layout, origin, trace)) {
      return layout;
    }
    // }

    return null;
  }

  buildLayout(base: Base, layout: BaseLayout, origin: RoomPosition, trace: Tracer): void {
    trace.info('building layout', {layout});

    let toBuild: PossibleSite[] = [];
    let numSites = 0;

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error('no primary room');
      return;
    }

    // const roomVisual = new RoomVisual(room.name);
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
          trace.info('structure present', {structure: structure.structureType});

          if (structure.structureType !== buildingCodes[code]) {
            trace.warn('wrong site, remove', {existing: structure.structureType, expected: buildingCodes[code]});
            structure.destroy();
          }

          continue;
        }

        const site = pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
        if (site) {
          numSites++;

          if (site.structureType !== buildingCodes[code]) {
            trace.warn('wrong site, remove', {existing: site.structureType, expected: buildingCodes[code]});
            site.remove();
          }

          continue;
        }

        const structureType = buildingCodes[code];
        if (!structureType || structureType === EMPTY) {
          continue;
        }

        toBuild.push({x: pos.x, y: pos.y, structureType});
      }
    }

    if (numSites > MAX_STRUCTURE_SITES) {
      trace.info('too many sites', {numSites});
      return;
    }

    // Sort by type priority
    toBuild = prioritizeBySitesType(toBuild);

    // Build sites until we hit max sites
    while (toBuild.length > 0) {
      if (numSites >= MAX_STRUCTURE_SITES) {
        return;
      }

      // Remove first item from the list
      const site = toBuild.shift();
      if (!site) {
        continue;
      }

      const pos = new RoomPosition(site.x, site.y, room.name);
      const result = room.createConstructionSite(pos, site.structureType);
      if (result !== OK && result !== ERR_FULL) {
        trace.error('failed to build structure', {structureType: site.structureType, pos, result});
        return;
      }

      numSites++;
      trace.notice('building', {structureType: site.structureType, pos, result});
    }
  }

  buildWalls(kernel: Kernel, base: Base, trace: Tracer): void {
    if (!base.walls) {
      return;
    }

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.error('no primary room');
      return;
    }

    if (!room.storage) {
      trace.info('no storage');
      return;
    }

    trace.info('building walls', {roomId: room.name});

    let numWallSites = 0;

    base.walls.forEach((wall) => {
      if (numWallSites >= MAX_WALL_SITES) {
        return;
      }

      const position = new RoomPosition(wall.x, wall.y, room.name);

      const road = position.lookFor(LOOK_STRUCTURES).find((structure) => {
        return structure.structureType === STRUCTURE_ROAD;
      });

      const roadSite = position.lookFor(LOOK_CONSTRUCTION_SITES).find((site) => {
        return site.structureType === STRUCTURE_ROAD;
      });

      const passage = _.find(base.passages, {x: position.x, y: position.y});

      let expectedStructure: (STRUCTURE_WALL | STRUCTURE_RAMPART) = STRUCTURE_WALL;
      if (road || roadSite || passage) {
        expectedStructure = STRUCTURE_RAMPART;
      }

      const structure = position.lookFor(LOOK_STRUCTURES).find((structure) => {
        return structure.structureType === expectedStructure;
      });
      if (structure) {
        trace.info('structure present', {structure: structure.structureType});
        return;
      }

      let foundSite = false;

      const sites = position.lookFor(LOOK_CONSTRUCTION_SITES);
      if (sites) {
        const expectedSite = sites.find((site) => {
          return site.structureType === expectedStructure;
        });

        if (expectedSite) {
          trace.info('site present', {site: expectedSite.structureType});
          numWallSites++;
          foundSite = true;
        } else {
          sites.forEach((site) => {
            // dont remove road site
            if (site.structureType === STRUCTURE_ROAD) {
              return;
            }

            trace.info('wrong site, remove', {existing: site.structureType, expected: expectedStructure});
            site.remove();
          });
        }
      }

      if (!foundSite) {
        const result = room.createConstructionSite(wall.x, wall.y, expectedStructure);
        if (result !== OK) {
          trace.error('failed to build structure', {result, pos: position, structureType: expectedStructure});
          return;
        }

        trace.notice('building site', {wall, structureType: expectedStructure});
      }
    });
  }

  layoutComplete(layout: BaseLayout, origin: RoomPosition, trace: Tracer): boolean {
    if (layout.buildings.length === 0) {
      return true;
    }

    for (let y = 0; y < layout.buildings.length; y++) {
      const row = layout.buildings[y];
      for (let x = 0; x < row.length; x++) {
        const pos = getConstructionPosition({x, y}, origin, layout);
        const structures = pos.lookFor(LOOK_STRUCTURES);

        const code = row[x];

        // Anything can be there
        if (buildingCodes[code] === ANY) {
          continue;
        }

        // No structures and empty
        if (buildingCodes[code] === EMPTY && !structures.length) {
          continue;
        }

        if (!structures.length) {
          trace.info('missing structures', {pos});
          return false;
        }

        if (structures.length && structures[0].structureType !== buildingCodes[code]) {
          trace.info('incorrect structure present', {pos, structures: structures.map((s) => s.structureType)});
          return false;
        }
      }
    }

    return true;
  }
}
