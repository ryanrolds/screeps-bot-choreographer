import {ENTIRE_ROOM_BOUNDS, getCutTiles} from "../lib/min_cut";
import {Tracer} from "../lib/tracing";
import {Base, getBaseLevel, getBasePrimaryRoom} from "../os/kernel/base";
import {Kernel} from "../os/kernel/kernel";
import {Runnable, RunnableResult, sleeping, terminate} from "../os/process";

const RUN_INTERVAL = 100;
const MAX_WALL_SITES = 5;

export class WallsRunnable implements Runnable {
  private baseId: string;

  constructor(baseId: string) {
    this.baseId = baseId;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('base not found', {baseId: this.baseId});
      return terminate();
    }

    if (!base.walls.length) {
      this.updateBaseWalls(kernel, base, trace);
    }

    const baseLevel = getBaseLevel(base);
    if (baseLevel >= 3) {
      this.buildWalls(kernel, base, trace);
    }

    return sleeping(RUN_INTERVAL)
  }

  private updateBaseWalls(kernel: Kernel, base: Base, trace: Tracer) {
    const baseBounds = {
      x1: base.origin.x - 9, y1: base.origin.y - 9,
      x2: base.origin.x + 9, y2: base.origin.y + 9,
    };

    const [walls] = getCutTiles(base.primary, [baseBounds], ENTIRE_ROOM_BOUNDS);
    base.walls = walls;

    trace.info('updated walls', {base: base});
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

      // Every other spot is a rampart
      if (position.x % 2 != position.y % 2) {
        expectedStructure = STRUCTURE_RAMPART;
      }

      const structures = position.lookFor(LOOK_STRUCTURES);

      // Remove undesired structures
      const undesiredStructures = structures.filter((structure) => {
        return structure.structureType !== expectedStructure && structure.structureType !== STRUCTURE_ROAD;
      });
      undesiredStructures.forEach((structure) => {
        structure.destroy();
      });

      // If desired structure is present, we are done
      const desiredStructure = structures.find((structure) => {
        return structure.structureType === expectedStructure;
      });
      if (desiredStructure) {
        trace.info('structure present', {structure: desiredStructure.structureType, position: position});
        return;
      }

      let foundSite = false;

      // Check for sites
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
}
