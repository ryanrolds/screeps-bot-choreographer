import {
  createCommonCostMatrix, createDefenderCostMatrix,
  createPartyCostMatrix, createOpenSpaceMatrix
} from "./lib.costmatrix";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";

const COST_MATRIX_TTL = 1000;

export enum AllowedCostMatrixTypes {
  PARTY = 'party',
  COMMON = 'common',
  BASE_DEFENSE = 'base',
  OPEN_SPACE = 'open_space',
};

export class CostMatrixCacheItem {
  roomId: string;
  time: number;
  costMatrix: CostMatrix | boolean;
  costMatrixType: AllowedCostMatrixTypes;

  constructor(id: string, costMatrixType: AllowedCostMatrixTypes) {
    this.roomId = id;
    this.costMatrixType = costMatrixType;
    this.costMatrix = null;
    this.time = 0;
  }

  update(trace) {
    let costMatrix: CostMatrix | boolean = new PathFinder.CostMatrix();

    trace.log('updating', {room: this.roomId, type: this.costMatrixType});

    switch (this.costMatrixType) {
      case AllowedCostMatrixTypes.PARTY:
        costMatrix = createPartyCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.COMMON:
        costMatrix = createCommonCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.BASE_DEFENSE:
        costMatrix = createDefenderCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.OPEN_SPACE:
        [costMatrix] = createOpenSpaceMatrix(this.roomId, trace);
      default:
        trace.error('unknown cost matrix type', {type: this.costMatrixType})
    }

    this.costMatrix = costMatrix;
    this.time = Game.time;
  }

  getCostMatrix(trace: Tracer) {
    if (!this.costMatrix || this.isExpired(Game.time)) {
      trace.log('cache miss/expired', {
        room: this.roomId,
        type: this.costMatrixType,
        expired: this.isExpired(Game.time)
      });
      this.update(trace);
    } else {
      trace.log('cache hit', {room: this.roomId, type: this.costMatrixType})
    }

    return this.costMatrix;
  }

  isExpired(time) {
    return time - this.time > COST_MATRIX_TTL;
  }
}

export class CostMatrixCache {
  rooms: Record<string, Record<Partial<AllowedCostMatrixTypes>, CostMatrixCacheItem>>;

  constructor() {
    this.rooms = {};
  }

  getCostMatrix(roomId: string, costMatrixType: AllowedCostMatrixTypes, trace: Tracer): CostMatrix | boolean {
    trace.log('get cost matrix', {roomId, costMatrixType});

    if (!this.rooms[roomId]) {
      trace.log('room not in cache', {roomId});
      this.rooms[roomId] = {} as Record<Partial<AllowedCostMatrixTypes>, CostMatrixCacheItem>;
    }

    let roomMatrix = this.rooms[roomId][costMatrixType];
    if (!roomMatrix) {
      trace.log('matrix type not in room cache', {roomId, costMatrixType});
      roomMatrix = new CostMatrixCacheItem(roomId, costMatrixType);
      this.rooms[roomId][costMatrixType] = roomMatrix;
    }

    return roomMatrix.getCostMatrix(trace);
  }

  getStats() {
    return {
      roomCacheSize: Object.keys(this.rooms).length,
    };
  }
}