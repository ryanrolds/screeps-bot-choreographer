import { ANY, buildingCodes, EMPTY, getConstructionPosition } from '../lib/layouts';
import { MusterPoint } from '../lib/muster';
import { Tracer } from '../lib/tracing';
import { Base, getBaseLevel, getBasePrimaryRoom, setParking } from '../os/kernel/base';
import { Kernel } from '../os/kernel/kernel';
import { RunnableResult, sleeping, terminate } from '../os/process';

const CONSTRUCTION_INTERVAL = 100;
const MAX_STRUCTURE_SITES = 5;

export type BaseLayout = {
  origin: {x: number, y: number};
  parking: {x: number, y: number};
  muster: MusterPoint[];
  buildings: string[][];
}

export const baseLayouts: BaseLayout[] = [
  { // RCL0
    origin: {x: 0, y: 0},
    parking: {x: 0, y: 0},
    muster: [],
    buildings: [],
  },
  { // RCL1
    origin: {x: 0, y: 4},
    parking: {x: 0, y: 0},
    muster: [
      {x: -3, y: -1, direction: TOP},
      {x: -3, y: 1, direction: BOTTOM},
      {x: 3, y: -1, direction: TOP},
      {x: 3, y: 1, direction: BOTTOM},
    ],
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
    muster: [
      {x: -4, y: -1, direction: TOP},
      {x: -4, y: 1, direction: BOTTOM},
      {x: 4, y: -1, direction: TOP},
      {x: 4, y: 1, direction: BOTTOM},
    ],
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
    muster: [
      {x: -5, y: -2, direction: TOP},
      {x: -5, y: 2, direction: BOTTOM},
      {x: 5, y: -2, direction: TOP},
      {x: 5, y: 2, direction: BOTTOM},
      {x: -2, y: -5, direction: LEFT},
      {x: 2, y: -5, direction: RIGHT},
      {x: -2, y: 5, direction: LEFT},
      {x: 2, y: 5, direction: RIGHT},
    ],
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
    muster: [
      {x: -8, y: -2, direction: TOP},
      {x: -8, y: 2, direction: BOTTOM},
      {x: 8, y: -2, direction: TOP},
      {x: 8, y: 2, direction: BOTTOM},
      {x: -2, y: -8, direction: LEFT},
      {x: 2, y: -8, direction: RIGHT},
      {x: -2, y: 8, direction: LEFT},
      {x: 2, y: 8, direction: RIGHT},
    ],
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
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    muster: [
      {x: -8, y: -2, direction: TOP},
      {x: -8, y: 2, direction: BOTTOM},
      {x: 8, y: -2, direction: TOP},
      {x: 8, y: 2, direction: BOTTOM},
      {x: -2, y: -8, direction: LEFT},
      {x: 2, y: -8, direction: RIGHT},
      {x: -2, y: 8, direction: LEFT},
      {x: 2, y: 8, direction: RIGHT},
    ],
    buildings: [
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', 'R', 'R', 'E', 'R', 'E', 'R', 'R', '.', '.', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'P', 'R', 'E', 'E', 'R', '.', '.'],
      ['.', 'R', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', 'R', '.'],
      ['.', 'R', '.', 'X', 'X', 'R', 'X', 'R', 'X', 'X', '.', 'R', '.'],
      ['.', '.', 'R', 'X', 'R', 'T', 'R', 'E', 'R', 'X', 'R', '.', '.'],
      ['.', '.', '.', 'R', 'X', 'R', 'S', 'R', 'L', 'R', '.', '.', '.'],
      ['.', '.', 'R', 'X', 'R', 'E', 'R', 'T', 'R', '.', 'R', '.', '.'],
      ['.', 'R', '.', 'X', 'X', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', 'R', '.', 'E', 'E', 'R', 'E', 'R', 'R', 'X', 'R', 'R', '.'],
      ['.', '.', 'R', 'E', 'E', 'R', 'X', 'R', 'R', 'R', 'R', 'R', '.'],
      ['.', '.', '.', 'R', 'R', 'E', 'R', 'E', 'R', 'R', 'R', '.', '.'],
      ['.', '.', '.', 'E', 'E', 'R', 'E', 'R', 'E', 'E', '.', '.', '.'],
      ['.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.', '.'],
    ],
  },
  { // RCL6
    origin: {x: 6, y: 7},
    parking: {x: 3, y: 3},
    muster: [
      {x: -8, y: -2, direction: TOP},
      {x: -8, y: 2, direction: BOTTOM},
      {x: 8, y: -2, direction: TOP},
      {x: 8, y: 2, direction: BOTTOM},
      {x: -2, y: -8, direction: LEFT},
      {x: 2, y: -8, direction: RIGHT},
      {x: -2, y: 8, direction: LEFT},
      {x: 2, y: 8, direction: RIGHT},
    ],
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
    muster: [
      {x: -8, y: -2, direction: TOP},
      {x: -8, y: 2, direction: BOTTOM},
      {x: 8, y: -2, direction: TOP},
      {x: 8, y: 2, direction: BOTTOM},
      {x: -2, y: -8, direction: LEFT},
      {x: 2, y: -8, direction: RIGHT},
      {x: -2, y: 8, direction: LEFT},
      {x: 2, y: 8, direction: RIGHT},
    ],
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
    muster: [
      {x: -8, y: -2, direction: TOP},
      {x: -8, y: 2, direction: BOTTOM},
      {x: 8, y: -2, direction: TOP},
      {x: 8, y: 2, direction: BOTTOM},
      {x: -2, y: -8, direction: LEFT},
      {x: 2, y: -8, direction: RIGHT},
      {x: -2, y: 8, direction: LEFT},
      {x: 2, y: 8, direction: RIGHT},
    ],
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



export const getPrioritizedSites = function (room: Room): ConstructionSite[] {
  let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (!sites || !sites.length) {
    return [];
  }

  sites = _.sortBy(sites, (site) => {
    switch (site.structureType) {
      case STRUCTURE_SPAWN:
        return 0 - site.progress / site.progressTotal;
      case STRUCTURE_TOWER:
        return 1 - site.progress / site.progressTotal;
      case STRUCTURE_RAMPART:
        return 2 - site.progress / site.progressTotal;
      case STRUCTURE_WALL:
        return 3 - site.progress / site.progressTotal;
      case STRUCTURE_STORAGE:
        return 4 - site.progress / site.progressTotal;
      case STRUCTURE_LINK:
        return 5 - site.progress / site.progressTotal;
      case STRUCTURE_EXTRACTOR:
        return 6 - site.progress / site.progressTotal;
      case STRUCTURE_EXTENSION:
        return 7 - site.progress / site.progressTotal;
      case STRUCTURE_TERMINAL:
        return 8 - site.progress / site.progressTotal;
      case STRUCTURE_LAB:
        return 9 - site.progress / site.progressTotal;
      case STRUCTURE_CONTAINER:
        return 10 - site.progress / site.progressTotal;
      case STRUCTURE_ROAD:
        return 20 - site.progress / site.progressTotal;
      default:
        return 15 - site.progress / site.progressTotal;
    }
  });

  return sites;
};


export type PossibleSite = {
  x: number;
  y: number;
  structureType: BuildableStructureConstant;
}

export const prioritizeBySitesType = (sites: PossibleSite[]): PossibleSite[] => {
  return _.sortBy(sites, (site) => {
    switch (site.structureType) {
      case STRUCTURE_SPAWN:
        return 0;
      case STRUCTURE_TOWER:
        return 1;
      case STRUCTURE_RAMPART:
        return 2;
      case STRUCTURE_WALL:
        return 3;
      case STRUCTURE_STORAGE:
        return 4;
      case STRUCTURE_LINK:
        return 5;
      case STRUCTURE_EXTENSION:
        return 6;
      case STRUCTURE_TERMINAL:
        return 7;
      case STRUCTURE_EXTRACTOR:
        return 8;
      case STRUCTURE_LAB:
        return 9;
      case STRUCTURE_CONTAINER:
        return 10;
      case STRUCTURE_ROAD:
        return 20;
      default:
        return 15;
    }
  });
};

export const getInfrastructureSites = function (room: Room): ConstructionSite[] {
  let sites = room.find(FIND_MY_CONSTRUCTION_SITES).filter((site) => {
    return site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_TOWER ||
      site.structureType === STRUCTURE_STORAGE || site.structureType === STRUCTURE_EXTENSION ||
      site.structureType === STRUCTURE_CONTAINER;
  });
  if (!sites || !sites.length) {
    return [];
  }

  sites = _.sortBy(sites, (site) => {
    switch (site.structureType) {
      case STRUCTURE_SPAWN:
        return 0 - site.progress / site.progressTotal;
      case STRUCTURE_TOWER:
        return 1 - site.progress / site.progressTotal;
      case STRUCTURE_STORAGE:
        return 2 - site.progress / site.progressTotal;
      case STRUCTURE_EXTENSION:
        return 3 - site.progress / site.progressTotal;
      default:
        return 15 - site.progress / site.progressTotal;
    }
  });

  return sites;
};
