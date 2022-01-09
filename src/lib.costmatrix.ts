import {getRegion} from "./lib.flood_fill";
import {buildingCodes, Layout} from "./lib.layouts";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {baseLayouts} from "./runnable.base_construction";

let costMatrix255 = null;

export const createDefenderCostMatrix = (roomId: string, trace: Tracer): CostMatrix => {
  let costMatrix = new PathFinder.CostMatrix();

  const room = Game.rooms[roomId]
  if (!room) {
    return costMatrix;
  }

  const spawn = room.find(FIND_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_SPAWN
  })[0];


  if (!spawn) {
    // No spawn, return a cost matrix with 0s
    return new PathFinder.CostMatrix();
  }

  const costs = get255CostMatrix();

  // Set every position in base to 0
  const regionValues = Object.values(getRegion(room, spawn.pos));
  regionValues.forEach((pos: RoomPosition) => {
    costs.set(pos.x, pos.y, 0);
  });

  return costs;
}

export const createCommonCostMatrix = (roomName: string, trace: Tracer): CostMatrix => {
  let costMatrix = new PathFinder.CostMatrix();

  const room = Game.rooms[roomName]
  if (!room) {
    trace.log('room not visible', {roomName: roomName});
    return costMatrix;
  }

  const terrain = Game.map.getRoomTerrain(roomName);

  const structures = room.find(FIND_STRUCTURES);
  trace.log('found structures', {numStructures: structures.length});

  // Favor roads and avoid blocking structures
  structures.forEach(function (struct) {
    if (struct.structureType === STRUCTURE_ROAD) {
      // Favor roads over plain tiles
      costMatrix.set(struct.pos.x, struct.pos.y, 1);
    }


    if (struct.structureType === STRUCTURE_STORAGE) {
      for (let x = struct.pos.x - 1; x <= struct.pos.x + 1; x++) {
        for (let y = struct.pos.y - 1; y <= struct.pos.y + 1; y++) {
          if (x < 0 || x < 0 || y > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
            continue;
          }

          // Dont override roads
          if (costMatrix.get(x, y) < 3) {
            costMatrix.set(x, y, 3);
          }
        }
      }
    }


    if (struct.structureType === STRUCTURE_CONTROLLER) {
      const controllerPos = struct.pos;
      for (let x = controllerPos.x - 3; x <= controllerPos.x + 3; x++) {
        for (let y = controllerPos.y - 3; y <= controllerPos.y + 3; y++) {
          if (x < 0 || x < 0 || y > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
            continue;
          }

          costMatrix.set(x, y, 5);
        }
      }
    }

    // TODO figure out how to not use "any"
    const isObstacle = OBSTACLE_OBJECT_TYPES.indexOf(struct.structureType as any) > -1;
    if (isObstacle) {
      costMatrix.set(struct.pos.x, struct.pos.y, 255);
    }
  });

  // Avoid controllers
  structures.filter(structure => structure.structureType === STRUCTURE_CONTROLLER).forEach(structure => {
    getNearbyPositions(structure.pos, 3).forEach((pos) => {
      if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL && costMatrix.get(pos.x, pos.y) < 3) {
        costMatrix.set(pos.x, pos.y, 3);
      }
    });
  });

  // avoid sources
  applySourceBuffer(room, costMatrix, terrain, 5, trace);

  // Also add construction sites to desired path
  room.find(FIND_CONSTRUCTION_SITES).forEach((site) => {
    if (site.structureType === STRUCTURE_ROAD) {
      // Favor roads over plain tiles
      costMatrix.set(site.pos.x, site.pos.y, 1);
      return;
    }

    // TODO figure out how to not use "any"
    const isObstacle = OBSTACLE_OBJECT_TYPES.indexOf(site.structureType as any) > -1;
    if (isObstacle) {
      costMatrix.set(site.pos.x, site.pos.y, 255);
    }
  });

  return costMatrix;
}

export const createSourceRoadMatrix = (kingdom: Kingdom, roomName: string, trace: Tracer): CostMatrix => {
  let costMatrix = new PathFinder.CostMatrix();

  // If room is not visible then use empty matrix
  const room = Game.rooms[roomName];
  if (!room) {
    trace.log('room not visible', {roomName: roomName});
    return costMatrix;
  }

  const terrain = Game.map.getRoomTerrain(roomName);

  const structures = room.find(FIND_STRUCTURES);
  trace.log('found structures', {numStructures: structures.length});

  structures.filter((s) => s.structureType !== STRUCTURE_ROAD).forEach(function (struct) {
    if (struct.structureType === STRUCTURE_CONTROLLER) {
      const controllerPos = struct.pos;
      for (let x = controllerPos.x - 3; x <= controllerPos.x + 3; x++) {
        for (let y = controllerPos.y - 3; y <= controllerPos.y + 3; y++) {
          if (x < 0 || x < 0 || y > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
            continue;
          }

          // Dont override roads
          if (costMatrix.get(x, y) === 0) {
            costMatrix.set(x, y, 5);
          }
        }
      }
    } else if (struct.structureType !== STRUCTURE_CONTAINER &&
      (struct.structureType !== STRUCTURE_RAMPART || !struct.my)) {

      // Controller links dont count as obstacle, otherwise controller pad will shift around
      if (struct.structureType === STRUCTURE_LINK && room.controller.pos.inRangeTo(struct.pos, 2)) {
        return;
      }

      // Can't walk through non-walkable buildings
      costMatrix.set(struct.pos.x, struct.pos.y, 255);
    }
  });

  applySourceBuffer(room, costMatrix, terrain, 5, trace);

  // Add existing roads
  structures.filter((s) => s.structureType === STRUCTURE_ROAD).forEach(function (struct) {
    const cost = costMatrix.get(struct.pos.x, struct.pos.y);
    if (cost >= 5 && cost != 255) {
      costMatrix.set(struct.pos.x, struct.pos.y, cost - 2);
      return;
    }

    costMatrix.set(struct.pos.x, struct.pos.y, 1);
  });

  // Add roads in base final base layout
  const baseConfig = kingdom.getPlanner().getBaseConfigById(roomName);
  if (baseConfig) {
    const layout: Layout = baseLayouts[8];
    const buildings = layout.buildings;

    for (let i = 0; i < buildings.length; i++) {
      for (let j = 0; j < buildings[i].length; j++) {
        if (buildingCodes[buildings[i][j]] === STRUCTURE_ROAD) {

          const y = baseConfig.origin.y - layout.origin.y + i;
          const x = baseConfig.origin.x - layout.origin.x + j;

          costMatrix.set(x, y, 1);
        }
      }
    }
  }

  // Marking parking lot as avoid
  const orgRoom = kingdom.getRoomColony(roomName)?.getRoomByID(roomName);
  if (orgRoom) {
    const parking = orgRoom.getParkingLot();
    if (parking) {
      for (let x = parking.pos.x - 1; x <= parking.pos.x + 1; x++) {
        for (let y = parking.pos.y - 1; y <= parking.pos.y + 1; y++) {
          if (x < 0 || x < 0 || y > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
            continue;
          }

          costMatrix.set(x, y, 10);
        }
      }
    }
  }

  return costMatrix;
}

export const createPartyCostMatrix = (roomName: string, trace: Tracer): CostMatrix | boolean => {
  const costMatrix = new PathFinder.CostMatrix();

  const terrain = Game.map.getRoomTerrain(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const mask = terrain.get(x, y);
      if (mask) {
        const maskValue = (mask === TERRAIN_MASK_WALL) ? 255 : 5;

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

  return costMatrix;
};

export const createOpenSpaceMatrix = (roomName: string, trace: Tracer): [CostMatrix, number, RoomPosition] => {
  trace = trace.begin('createOpenSpaceMatrix');

  const costMatrix = new PathFinder.CostMatrix();
  const seen: Record<string, boolean> = {};

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
        seen[x + ',' + y] = true;
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
        if (seen[pos.x + ',' + pos.y]) {
          return;
        }

        passes[pass].push(pos);
        seen[pos.x + ',' + pos.y] = true;
        costMatrix.set(pos.x, pos.y, pass);
      });
    });
  } while (passes[pass].length);

  const position = passes[pass - 1][0];
  const cpuTime = trace.end();
  trace.log('results', {cpuTime, pass, position});

  return [costMatrix, pass, position];
};

// get position surrounding a room position
const getNearbyPositions = (center: RoomPosition, range: number): RoomPosition[] => {
  const positions = [];
  for (let x = center.x - range; x <= center.x + range; x++) {
    for (let y = center.y - range; y <= center.y + range; y++) {
      if (x === center.x && y === center.y) {
        continue;
      }

      if (x < 0 || y < 0 || x > 49 || y > 49) {
        continue;
      }

      positions.push(new RoomPosition(x, y, center.roomName));
    }
  }

  return positions;
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
}

export const visualizeCostMatrix = (roomName: string, costMatrix: CostMatrix, trace: Tracer) => {
  if (typeof (costMatrix) === "boolean") {
    trace.log('costmatrix is boolean', {roomName})
    return;
  }

  trace.log('show matrix', {roomName})

  const visual = new RoomVisual(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const cost = costMatrix.get(x, y);
      visual.text((cost).toString(), x, y);
    }
  }
}

const applySourceBuffer = (room: Room, costMatrix: CostMatrix, terrain: RoomTerrain,
  cost: number, trace: Tracer) => {

  let sources: (Source | Mineral)[] = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);
  sources = sources.concat(minerals);

  trace.log('found sources and minerals', {numStructures: sources.length});

  sources.forEach(function (source) {
    const pos = source.pos;
    for (let x = pos.x - 2; x < pos.x + 3; x++) {
      for (let y = pos.y - 2; y < pos.y + 3; y++) {
        if (x < 0 || x < 0 || y > 49 || y > 49 || terrain.get(x, y) === TERRAIN_MASK_WALL) {
          continue;
        }

        // Dont override roads
        if (costMatrix.get(x, y) === 0) {
          costMatrix.set(x, y, cost);
        }
      }
    }
  });
};
