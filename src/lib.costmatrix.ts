




createDefenderCostMatric(room: Room, spawn: RoomPosition): CostMatrix {
  const costs = new PathFinder.CostMatrix();

  return costs;
}

getDefenderCostMatrix(room: Room, spawn: RoomPosition): CostMatrix {
  const costMatrixEntry = this.journal.defenderCostMatrices[room.name];
  if (costMatrixEntry && costMatrixEntry.ttl <= Game.time) {
    return
  }

  const costs = this.createDefenderCostMatric(room, spawn);

  this.journal.defenderCostMatrices[room.name] = {
    id: room.name as Id<Room>,
    costs,
    ttl: Game.time + COST_MATRIX_TTL,
  };

  return costs;
}


/*
getColonyCostMatrix(colony: Colony): CostMatrix {
  const costMatrixEntry = this.journal.defenderCostMatrices[room.name];
  if (costMatrixEntry && costMatrixEntry.ttl <= Game.time) {
    return
  }

  const costs = this.createDefenderCostMatric(room, spawn);

  this.journal.defenderCostMatrices[room.name] = {
    id: room.name as Id<Room>,
    costs,
    ttl: Game.time + COST_MATRIX_TTL,
  };

  return costs;
}
*/

createColonyCostMatrix(colony: Colony): CostMatrix {
  const room = colony.primaryRoom;
  const spawn = room.find(FIND_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_SPAWN
  })[0];


  if (!spawn) {
    // No spawn, return a cost matrix with 0s
    return new PathFinder.CostMatrix();
  }

  const costs = this.get255CostMatrix();

  // Set every position in base to 0
  const regionValues = Object.values(getRegion(room, spawn.pos));
  regionValues.forEach((pos: Position) => {
    costs.set(pos.x, pos.y, 0);
  });

  return costs;
}

get255CostMatrix(): CostMatrix {
  if (this.costMatrix255) {
    return this.costMatrix255.clone();
  }

  const costs = new PathFinder.CostMatrix();
  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      costs.set(x, y, 255);
    }
  }

  this.costMatrix255 = costs;

  return costs.clone();
}

visualizeCostMatrix(roomName: string, costMatrix: CostMatrix) {
  const visual = new RoomVisual(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const cost = costMatrix.get(x, y);
      visual.text((cost / 5).toString(), x, y);
    }
  }
}
}




getRoomCostMatrix(roomName: string): CostMatrix | boolean {
  if (this.costMatrices[roomName]) {
    return this.costMatrices[roomName];
  }

  const costMatrix = new PathFinder.CostMatrix();

  const room = Game.rooms[roomName];
  if (!room) {
    return costMatrix;
  }

  const owner = room.controller?.owner?.username;
  if (owner) {
    if (this.kingdom.config.friends.indexOf(owner) !== -1) {
      return false;
    }
    if (this.kingdom.config.neutral.indexOf(owner) !== -1) {
      return false;
    }
  }

  const terrain = Game.map.getRoomTerrain(roomName);

  for (let x = 0; x <= 49; x++) {
    for (let y = 0; y <= 49; y++) {
      const mask = terrain.get(x, y);
      if (mask) {
        const maskValue = (mask === TERRAIN_MASK_WALL) ? 255 : 5;

        if (costMatrix.get(x, y) < maskValue) {
          costMatrix.set(x, y, maskValue);
        }

        if (x !== 0 && costMatrix.get(x - 1, y) < maskValue) {
          costMatrix.set(x - 1, y, maskValue);
        }

        if (y < 49 && costMatrix.get(x, y + 1) < maskValue) {
          costMatrix.set(x, y + 1, maskValue);
        }

        if (x !== 0 && y < 49 && costMatrix.get(x - 1, y + 1) < maskValue) {
          costMatrix.set(x - 1, y + 1, maskValue);
        }

        continue;
      }

      if (x <= 1 || y <= 1 || x >= 48 || y >= 48) {
        if (costMatrix.get(x, y) < 25) {
          costMatrix.set(x, y, 25);
        }
      }
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

  const walls = room.find<StructureWall>(FIND_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_WALL
  });
  walls.forEach((wall) => {
    let wallValue = 255;
    if (room.controller?.owner?.username !== 'ENETDOWN') {
      wallValue == 25 + (wall.hits / 300000000 * 100);
    }

    costMatrix.set(wall.pos.x, wall.pos.y, wallValue);
    costMatrix.set(wall.pos.x - 1, wall.pos.y, wallValue);
    costMatrix.set(wall.pos.x - 1, wall.pos.y + 1, wallValue);
    costMatrix.set(wall.pos.x, wall.pos.y + 1, wallValue);
  });
  */

  this.costMatrices[roomName] = costMatrix;

  return costMatrix;
}
