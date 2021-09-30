import {UNLOAD_LINK} from "./constants.priorities";
import {FindPathPolicy, getPath} from "./lib.pathing";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";

const COST_MATRIX_TTL = 1000;

export enum AllowedCostMatrixTypes {
  PARTY = 'party',
  COMMON = 'common',
  BASE_DEFENSE = 'base',
};

export class RoomCostMatrix {
  roomId: string;
  time: number;
  costMatrix: CostMatrix;
  costMatrixType: AllowedCostMatrixTypes;

  constructor(id: string) {
    this.roomId = id;
    this.costMatrix = null;
    this.time = 0;
  }
  update() {
    let costMatrix = new PathFinder.CostMatrix();

    switch (this.costMatrixType) {
      case AllowedCostMatrixTypes.PARTY:
        break;
      case AllowedCostMatrixTypes.COMMON:
        break;
      case AllowedCostMatrixTypes.BASE_DEFENSE:
        break;
    }

    this.costMatrix = costMatrix;
    this.time = Game.time;
  }
  getCostMatrix() {
    if (!this.costMatrix || this.isExpired(Game.time)) {
      this.update();
    }

    return this.costMatrix;
  }
  isExpired(time) {
    return time - this.time > COST_MATRIX_TTL;
  }
}

export class CostMatrixCache {
  rooms: Record<string, Record<Partial<AllowedCostMatrixTypes>, RoomCostMatrix>>;

  constructor() {
    this.rooms = {};
  }

  getCostMatrix(roomId: string, costMatrixType: AllowedCostMatrixTypes): CostMatrix {
    let roomMatrix = this.rooms[roomId][costMatrixType];
    if (!roomMatrix) {
      roomMatrix = new RoomCostMatrix(roomId);
      this.rooms[roomId][costMatrixType] = roomMatrix;
    }

    return roomMatrix.getCostMatrix();
  }

  getStats() {
    return {
      roomCacheSize: Object.keys(this.rooms).length,
    };
  }
}
