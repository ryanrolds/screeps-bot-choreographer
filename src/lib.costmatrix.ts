import {stringify} from "querystring";
import {getRegion} from "./lib.flood_fill";
import {Tracer} from "./lib.tracing";
import {Colony} from "./org.colony";
import {Kingdom} from "./org.kingdom";

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

  const structures = room.find(FIND_STRUCTURES);
  trace.log('found structures', {numStructures: structures.length});
  // Favor roads and avoid blocking structures
  structures.forEach(function (struct) {
    if (struct.structureType === STRUCTURE_ROAD) {
      // Favor roads over plain tiles
      costMatrix.set(struct.pos.x, struct.pos.y, 1);
    } else if (OBSTACLE_OBJECT_TYPES.indexOf(struct.structureType as any) !== -1) {
      // Can't walk through non-walkable buildings
      costMatrix.set(struct.pos.x, struct.pos.y, 255);
    }
  });

  const sites = room.find(FIND_CONSTRUCTION_SITES);
  // Add blocking structures to the cost matrix
  trace.log('found construction sites', {numSites: sites.length});
  sites.forEach((site) => {
    if (OBSTACLE_OBJECT_TYPES.indexOf(site.structureType as any) !== -1) {
      costMatrix.set(site.pos.x, site.pos.y, 255);
    }
  });

  const terrain = Game.map.getRoomTerrain(roomName);

  // Avoid controllers
  structures.filter(structure => structure.structureType === STRUCTURE_CONTROLLER).forEach(structure => {
    getNearbyPositions(structure.pos, 3).forEach((pos) => {
      if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL && costMatrix.get(pos.x, pos.y) < 3) {
        costMatrix.set(pos.x, pos.y, 3);
      }
    });
  });

  // Avoid sources
  room.find(FIND_SOURCES).forEach((source) => {
    getNearbyPositions(source.pos, 2).forEach((pos) => {
      if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL && costMatrix.get(pos.x, pos.y) < 5) {
        costMatrix.set(pos.x, pos.y, 5);
      }
    });
  });

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
        if (y < 49 && costMatrix.get(x, y + 1) < maskValue) {
          costMatrix.set(x, y + 1, maskValue);
        }

        // left
        if (x > 0 && costMatrix.get(x - 1, y) < maskValue) {
          costMatrix.set(x - 1, y, maskValue);
        }

        // down left
        if (x > 0 && y < 49 && costMatrix.get(x - 1, y + 1) < maskValue) {
          costMatrix.set(x - 1, y + 1, maskValue);
        }

        continue;
      }

      /*
      if (x <= 1 || y <= 1 || x >= 48 || y >= 48) {
        if (costMatrix.get(x, y) < 25) {
          costMatrix.set(x, y, 25);
        }
      }
      */
    }
  }

  /*
  const structures = room.find<Structure>(FIND_STRUCTURES, {
    filter: structure => structure.structureType
  });
  structures.forEach((structure) => {
    if (structure.structureType === STRUCTURE_ROAD) {
      return;
    }

    let wallValue = 255;
    costMatrix.set(structure.pos.x, structure.pos.y, wallValue);
    costMatrix.set(structure.pos.x - 1, structure.pos.y, wallValue);
    costMatrix.set(structure.pos.x - 1, structure.pos.y + 1, wallValue);
    costMatrix.set(structure.pos.x, structure.pos.y + 1, wallValue);
  });
  */

  const room = Game.rooms[roomName];
  if (room) {
    const walls = room.find<StructureWall | StructureRampart>(FIND_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_WALL ||
        structure.structureType === STRUCTURE_RAMPART
    });
    walls.forEach((wall) => {
      if (wall.structureType === STRUCTURE_RAMPART) {
        return;
      }

      let wallValue = 255;
      if (room.controller?.owner?.username !== 'ENETDOWN') {
        wallValue = 10 + (wall.hits / 300000000 * 100);
      }

      const x = wall.pos.x;
      const y = wall.pos.y;

      // center
      if (costMatrix.get(x, y) < wallValue) {
        costMatrix.set(x, y, wallValue);
      }

      // down
      if (y < 49 && costMatrix.get(x, y + 1) < wallValue) {
        costMatrix.set(x, y + 1, wallValue);
      }

      // left
      if (x > 0 && costMatrix.get(x - 1, y) < wallValue) {
        costMatrix.set(x - 1, y, wallValue);
      }

      // down left
      if (x > 0 && y < 49 && costMatrix.get(x - 1, y + 1) < wallValue) {
        costMatrix.set(x - 1, y + 1, wallValue);
      }
    });
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
