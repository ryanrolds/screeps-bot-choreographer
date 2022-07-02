import {
  createCommonCostMatrix, createDefenderCostMatrix, createOpenSpaceMatrix, createPartyCostMatrix, createSourceRoadMatrix, haulerCostMatrixMatrix, singleRoomCommonMatrix
} from "./lib.costmatrix";
import {Tracer} from "./lib.tracing";

const COST_MATRIX_TTL = 1000;

export enum AllowedCostMatrixTypes {
  PARTY = 'party',
  COMMON = 'common',
  SINGLE_ROOM_COMMON = 'single_room_common',
  HAULER = 'hauler',
  BASE_DEFENSE = 'base',
  OPEN_SPACE = 'open_space',
  SOURCE_ROAD = 'source_road',
  CONTROLLER_ROAD = 'controller_road',
};

export class CostMatrixCacheItem {
  roomId: string;
  time: number;
  costMatrix: CostMatrix;
  costMatrixType: AllowedCostMatrixTypes;

  constructor(id: string, costMatrixType: AllowedCostMatrixTypes) {
    this.roomId = id;
    this.costMatrixType = costMatrixType;
    this.costMatrix = null;
    this.time = 0;
  }

  update(kernel: Kernel, trace: Tracer) {
    let costMatrix: CostMatrix = new PathFinder.CostMatrix();

    trace.log('updating', {room: this.roomId, type: this.costMatrixType});

    switch (this.costMatrixType) {
      case AllowedCostMatrixTypes.PARTY:
        costMatrix = createPartyCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.COMMON:
        costMatrix = createCommonCostMatrix(kingdom, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.SINGLE_ROOM_COMMON:
        costMatrix = singleRoomCommonMatrix(kingdom, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.HAULER:
        costMatrix = haulerCostMatrixMatrix(kingdom, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.BASE_DEFENSE:
        costMatrix = createDefenderCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.SOURCE_ROAD:
        costMatrix = createSourceRoadMatrix(kingdom, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.OPEN_SPACE:
        [costMatrix] = createOpenSpaceMatrix(this.roomId, trace);
        break;
      default:
        trace.error('unknown cost matrix type', {type: this.costMatrixType})
    }

    this.costMatrix = costMatrix;
    this.time = Game.time;
  }

  getCostMatrix(kernel: Kernel, trace: Tracer) {
    if (!this.costMatrix || this.isExpired(Game.time)) {
      trace.log('cache miss/expired', {
        room: this.roomId,
        type: this.costMatrixType,
        expired: this.isExpired(Game.time)
      });
      this.update(kingdom, trace);
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

  getCostMatrix(kernel: Kernel, roomId: string, costMatrixType: AllowedCostMatrixTypes, trace: Tracer): CostMatrix {
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

    return roomMatrix.getCostMatrix(kingdom, trace);
  }

  getStats() {
    return {
      roomCacheSize: Object.keys(this.rooms).length,
    };
  }
}
