/**
 * Cost Matrix
 *
 * Contains functions that create the various cost matrices used by
 * processes & creeps.
 *
 * TODO could be dried out a bit more
 * TODO add tests
 */

import {baseLayouts} from '../base/construction';
import {Base, getBaseLevel} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {getRegion} from './flood_fill';
import {buildingCodes, Layout} from './layouts';
import {getNearbyPositions} from './position';
import {Tracer} from './tracing';

let costMatrix255 = null;

export const createDefenderCostMatrix = (roomId: string, _trace: Tracer): CostMatrix => {
  const costMatrix = new PathFinder.CostMatrix();

  const room = Game.rooms[roomId];
  if (!room) {
    return costMatrix;
  }

  const spawn = room.find(FIND_STRUCTURES, {
    filter: (structure) => structure.structureType === STRUCTURE_SPAWN,
  })[0];


  if (!spawn) {
    // No spawn, return a cost matrix with 0s
    return new PathFinder.CostMatrix();
  }

  const costs = get255CostMatrix();

  // Set every position in base to 0
  const regionValues = Array.from(getRegion(room, spawn.pos).values());
  regionValues.forEach((pos: RoomPosition) => {
    costs.set(pos.x, pos.y, 0);
  });

  return costs;
};

// export const createDamageMatrix = (kernel: Kernel, roomName: string, damageThreshold: number, trace: Tracer): CostMatrix => {
//   const costMatrix = new PathFinder.CostMatrix();

//   const terrain = Game.map.getRoomTerrain(roomName);

//   // Add towers
//   // Add creeps

//   const room = Game.rooms[roomName];
//   if (!room) {
//     trace.info('room not visible', {roomName: roomName});

//     const entry = kernel.getScribe().getRoomById(roomName);
//     if (!entry) {
//       trace.info('room not in scribe', {roomName: roomName});
//       return costMatrix;
//     }

//     // TODO track tower positions in scribe

//     return costMatrix;
//   }

//   // Add tower damage to cost matrix
//   const structures = room.find(FIND_STRUCTURES);
//   structures.forEach((structure) => {
//     if (structure.structureType === STRUCTURE_TOWER) {
//       // Add tower damage to every position in the cost matrix
//       const pos = structure.pos;
//       for (let x = 0; x < 50; x++) {
//         for (let y = 0; y <= 50; y++) {
//           if (x < 0 || y < 0 || x > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
//             continue;
//           }

//           const current = costMatrix.get(x, y);
//           const dx = Math.abs(x - pos.x);
//           const dy = Math.abs(y - pos.y);
//           const distance = Math.sqrt(dx * dx + dy * dy);

//           let damage = current;
//           if (distance <= 5) {
//             damage + 600
//           } else if (distance > 19) {

//           } else {
//             const dmg = 600 - (distance - 6) * 30;

//           }
//         }
//       }
//     }
//   });

//   // Add creep damage to cost matrix
//   const creeps = room.find(FIND_HOSTILE_CREEPS);
//   creeps.forEach((creep) => {
//     const pos = creep.pos;

//     // Add attack parts

//     // Add ranged attack parts

//   });

//   return costMatrix;
// }

export const createHealingMatrix = (roomName: string, _trace: Tracer): CostMatrix => {
  const costMatrix = new PathFinder.CostMatrix();

  const _terrain = Game.map.getRoomTerrain(roomName);

  // Add towers
  // Add creeps

  return costMatrix;
}

export const createCommonCostMatrix = (kernel: Kernel, roomName: string, trace: Tracer): CostMatrix => {
  const costMatrix = new PathFinder.CostMatrix();

  const room = Game.rooms[roomName];
  if (!room) {
    trace.info('room not visible', {roomName: roomName});
    return costMatrix;
  }

  const terrain = Game.map.getRoomTerrain(roomName);

  const structures = room.find(FIND_STRUCTURES);
  trace.info('found structures', {numStructures: structures.length});
  // Favor roads and avoid blocking structures
  structures.forEach(function (struct) {
    if (struct.structureType === STRUCTURE_ROAD) {
      // Favor roads over plain tiles
      costMatrix.set(struct.pos.x, struct.pos.y, 1);
    }

    if (struct.structureType === STRUCTURE_STORAGE) {
      for (let x = struct.pos.x - 1; x <= struct.pos.x + 1; x++) {
        for (let y = struct.pos.y - 1; y <= struct.pos.y + 1; y++) {
          if (x < 0 || y < 0 || x > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
            continue;
          }

          // Dont override roads
          if (costMatrix.get(x, y) < 3) {
            costMatrix.set(x, y, 3);
          }
        }
      }
    }

    // TODO figure out how to not use "any"
    const isObstacle = (OBSTACLE_OBJECT_TYPES as string[]).indexOf(struct.structureType) > -1;
    if (isObstacle) {
      // Can't walk through non-walkable buildings
      costMatrix.set(struct.pos.x, struct.pos.y, 255);
    }
  });

  // Add blocking structures to the cost matrix
  const sites = room.find(FIND_CONSTRUCTION_SITES);
  trace.info('found construction sites', {numSites: sites.length});
  sites.forEach((site) => {
    if ((OBSTACLE_OBJECT_TYPES as string[]).indexOf(site.structureType) !== -1) {
      costMatrix.set(site.pos.x, site.pos.y, 255);
    }
  });

  // Avoid controllers
  structures.filter((structure) => structure.structureType === STRUCTURE_CONTROLLER).forEach((structure) => {
    getNearbyPositions(structure.pos, 3).forEach((pos) => {
      if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL && costMatrix.get(pos.x, pos.y) < 3) {
        costMatrix.set(pos.x, pos.y, 3);
      }
    });
  });

  // avoid sources
  applySourceMineralBuffer(room, costMatrix, terrain, 5, trace);

  const base = kernel.getPlanner().getBaseById(roomName);
  if (base) {
    // Dont path through the parking lot
    applyParkingLotBuffer(base, costMatrix, terrain, 5, trace);
  }

  return costMatrix;
};

export const singleRoomCommonMatrix = (kernel: Kernel, roomName: string, trace: Tracer): CostMatrix => {
  const costMatrix = createCommonCostMatrix(kernel, roomName, trace);

  // Block all exits
  for (let x = 0; x < 50; x++) {
    costMatrix.set(x, 0, 255);
    costMatrix.set(x, 49, 255);
  }
  for (let y = 0; y < 50; y++) {
    costMatrix.set(0, y, 255);
    costMatrix.set(49, y, 255);
  }

  return costMatrix;
};

export const haulerCostMatrixMatrix = (kernel: Kernel, roomName: string, trace: Tracer): CostMatrix => {
  const costMatrix = createCommonCostMatrix(kernel, roomName, trace);

  const terrain = Game.map.getRoomTerrain(roomName);

  // Add roads in base final base layout
  const base = kernel.getPlanner().getBaseById(roomName);
  if (base) {
    applyBaseRoads(base, costMatrix, terrain, 1, trace);

    // Don't path through the parking lot
    applyParkingLotBuffer(base, costMatrix, terrain, 5, trace);
  }

  return costMatrix;
};

export const createSourceRoadMatrix = (kernel: Kernel, roomName: string, trace: Tracer): CostMatrix => {
  const costMatrix = new PathFinder.CostMatrix();

  // If room is not visible then use empty matrix
  const room = Game.rooms[roomName];
  if (!room) {
    trace.error('room not visible', {roomName: roomName});
    return costMatrix;
  }

  const terrain = Game.map.getRoomTerrain(roomName);

  const structures = room.find(FIND_STRUCTURES);
  const nonRoadStructures = structures.filter((s) => s.structureType !== STRUCTURE_ROAD);

  nonRoadStructures.forEach(function (struct) {
    if (struct.structureType !== STRUCTURE_CONTAINER &&
      (struct.structureType !== STRUCTURE_RAMPART || !struct.my)) {
      // Controller links dont count as obstacle, otherwise controller pad will shift around
      if (struct.structureType === STRUCTURE_LINK && room.controller.pos.inRangeTo(struct.pos, 3)) {
        return;
      }

      // Give walls a low weight otherwise we will minimize holes, but only if
      // Only for rooms we control, we can destroy the walls
      if (room.controller?.my && struct.structureType === STRUCTURE_WALL) {
        costMatrix.set(struct.pos.x, struct.pos.y, 10);
        return;
      }

      // Can't walk through non-walkable buildings
      costMatrix.set(struct.pos.x, struct.pos.y, 255);
    }
  });

  applySourceMineralBuffer(room, costMatrix, terrain, 5, trace);
  applyRoads(room, costMatrix, 1, trace);
  applyRoadSites(room, costMatrix, 1, trace);

  // Add roads in base final base layout
  const base = kernel.getPlanner().getBaseById(roomName);
  if (base) {
    applyBaseRoads(base, costMatrix, terrain, 1, trace);
    applyControllerBuffer(costMatrix, terrain, room.controller, 4, trace);
    applyParkingLotBuffer(base, costMatrix, terrain, 5, trace);
  }

  return costMatrix;
};

export const createPartyCostMatrix = (roomName: string, _trace: Tracer): CostMatrix => {
  const costMatrix = new PathFinder.CostMatrix();

  const terrain = Game.map.getRoomTerrain(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const mask = terrain.get(x, y);
      if (mask) {
        const maskValue = (mask === TERRAIN_MASK_WALL) ? 255 : 5;

        // The party origin is the bottom left corner

        // center
        if (costMatrix.get(x, y) < maskValue) {
          costMatrix.set(x, y, maskValue);
        }

        // down
        if (x >= 0 && x <= 49 && y + 1 >= 0 && y + 1 <= 48 && costMatrix.get(x, y + 1) < maskValue) {
          costMatrix.set(x, y + 1, maskValue);
        }

        // left
        if (x - 1 >= 0 && x - 1 <= 49 && y >= 0 && y <= 48 && costMatrix.get(x - 1, y) < maskValue) {
          costMatrix.set(x - 1, y, maskValue);
        }

        // down left
        if (x - 1 >= 0 && x - 1 <= 49 && y + 1 >= 0 && y + 1 <= 48 && costMatrix.get(x - 1, y + 1) < maskValue) {
          costMatrix.set(x - 1, y + 1, maskValue);
        }

        continue;
      }

      if (x <= 1 || y <= 1 || x >= 48 || y >= 48) {
        if (costMatrix.get(x, y) < 5) {
          costMatrix.set(x, y, 5);
        }
      }
    }
  }

  const room = Game.rooms[roomName];
  if (room && room.controller?.my) {
    room.find(FIND_STRUCTURES).forEach((s) => {
      if ((OBSTACLE_OBJECT_TYPES as string[]).indexOf(s.structureType) !== -1) {
        costMatrix.set(s.pos.x, s.pos.y, 255);
      }
    });
  }

  return costMatrix;
};

export const createOpenSpaceMatrix = (roomName: string, trace: Tracer): [CostMatrix, number, RoomPosition] => {
  trace = trace.begin('createOpenSpaceMatrix');

  const costMatrix = new PathFinder.CostMatrix();
  const seen: Set<string> = new Set();

  let pass = 0;
  const passes: RoomPosition[][] = [];
  passes[pass] = [];

  // Add walls and room positions near edges to initial pass
  // Mark each position as seen
  const terrain = Game.map.getRoomTerrain(roomName);
  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      if (x < 3 || y < 3 || x > 46 || y > 46 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
        passes[pass].push(new RoomPosition(x, y, roomName));
        seen.add(`${x},${y}`);
        costMatrix.set(x, y, pass);
      }
    }
  }

  do {
    const currentPass = passes[pass];
    pass++;
    passes[pass] = [];

    currentPass.forEach((centerPos: RoomPosition) => {
      getNearbyPositions(centerPos, 1).forEach((pos) => {
        if (seen.has(`${pos.x},${pos.y}`)) {
          return;
        }

        passes[pass].push(pos);
        seen.add(`${pos.x},${pos.y}`);
        costMatrix.set(pos.x, pos.y, pass);
      });
    });
  } while (passes[pass].length);

  const position = passes[pass - 1][0];
  const cpuTime = trace.end();
  trace.info('results', {cpuTime, pass, position});

  return [costMatrix, pass, position];
};

const get255CostMatrix = (): CostMatrix => {
  if (costMatrix255) {
    return costMatrix255.clone();
  }

  const costs = new PathFinder.CostMatrix();
  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      costs.set(x, y, 255);
    }
  }

  costMatrix255 = costs;

  return costs.clone();
};

export const visualizeCostMatrix = (roomName: string, costMatrix: CostMatrix, trace: Tracer) => {
  if (typeof (costMatrix) === 'boolean') {
    trace.info('costmatrix is boolean', {roomName});
    return;
  }

  trace.info('show matrix', {roomName});

  const visual = new RoomVisual(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const cost = costMatrix.get(x, y);
      visual.text((cost).toString(), x, y);
    }
  }
};

const applyControllerBuffer = (costMatrix: CostMatrix, terrain: RoomTerrain,
  controller: StructureController, cost: number, _trace: Tracer) => {
  const controllerPos = controller.pos;
  for (let x = controllerPos.x - 3; x <= controllerPos.x + 3; x++) {
    for (let y = controllerPos.y - 3; y <= controllerPos.y + 3; y++) {
      if (x < 0 || y < 0 || x > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      // If the cost is already higher then leave it
      if (costMatrix.get(x, y) > cost) {
        continue;
      }

      costMatrix.set(x, y, cost);
    }
  }
};

const applySourceMineralBuffer = (room: Room, costMatrix: CostMatrix, terrain: RoomTerrain,
  cost: number, trace: Tracer) => {
  let sources: (Source | Mineral)[] = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);
  sources = sources.concat(minerals);

  trace.info('found sources and minerals', {numStructures: sources.length});

  sources.forEach(function (source) {
    const pos = source.pos;
    for (let x = pos.x - 2; x < pos.x + 3; x++) {
      for (let y = pos.y - 2; y < pos.y + 3; y++) {
        if (x < 0 || y < 0 || x > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
          continue;
        }

        // If the cost is already higher then leave it
        if (costMatrix.get(x, y) > cost) {
          continue;
        }

        costMatrix.set(x, y, cost);
      }
    }
  });
};

const applyRoads = (room: Room, costMatrix: CostMatrix, cost: number, _trace: Tracer) => {
  const structures = room.find(FIND_STRUCTURES);
  const roads = structures.filter((s) => s.structureType === STRUCTURE_ROAD);

  // Add existing roads
  roads.forEach(function (struct) {
    const currentCost = costMatrix.get(struct.pos.x, struct.pos.y);
    if (currentCost >= 5 && currentCost != 255) {
      costMatrix.set(struct.pos.x, struct.pos.y, currentCost - 2);
      return;
    }

    costMatrix.set(struct.pos.x, struct.pos.y, cost);
  });
};

const applyRoadSites = (room: Room, costMatrix: CostMatrix, cost: number, _trace: Tracer) => {
  // add road construction sites
  room.find(FIND_MY_CONSTRUCTION_SITES).forEach((site) => {
    if (site.structureType === STRUCTURE_ROAD) {
      const currentCost = costMatrix.get(site.pos.x, site.pos.y);
      if (currentCost >= 5 && currentCost != 255) {
        costMatrix.set(site.pos.x, site.pos.y, currentCost - 2);
        return;
      }

      costMatrix.set(site.pos.x, site.pos.y, cost);
    }
  });
};

const applyBaseRoads = (base: Base, costMatrix: CostMatrix, terrain: RoomTerrain,
  cost: number, _trace: Tracer) => {
  const layout: Layout = baseLayouts[getBaseLevel(base)];
  const buildings = layout.buildings;

  for (let i = 0; i < buildings.length; i++) {
    for (let j = 0; j < buildings[i].length; j++) {
      if (buildingCodes[buildings[i][j]] === STRUCTURE_ROAD) {
        const y = base.origin.y - layout.origin.y + i;
        const x = base.origin.x - layout.origin.x + j;

        costMatrix.set(x, y, cost);
      }
    }
  }
};

const applyParkingLotBuffer = (base: Base, costMatrix: CostMatrix, terrain: RoomTerrain,
  cost: number, _trace: Tracer) => {
  for (let x = base.parking.x - 1; x <= base.parking.x + 1; x++) {
    for (let y = base.parking.y - 1; y <= base.parking.y + 1; y++) {
      if (x < 0 || y < 0 || x > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      costMatrix.set(x, y, cost);
    }
  }
};
