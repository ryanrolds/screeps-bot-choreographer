import {
  createCommonCostMatrix, createDefenderCostMatrix, createOpenSpaceMatrix, createPartyCostMatrix, createSourceRoadMatrix, haulerCostMatrixMatrix, singleRoomCommonMatrix
} from './costmatrix';
import {Kernel} from './kernel';
import {Tracer} from './tracing';

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
  DAMAGE = 'damage',
}

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

    trace.info('updating', {room: this.roomId, type: this.costMatrixType});

    switch (this.costMatrixType) {
      case AllowedCostMatrixTypes.PARTY:
        costMatrix = createPartyCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.COMMON:
        costMatrix = createCommonCostMatrix(kernel, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.SINGLE_ROOM_COMMON:
        costMatrix = singleRoomCommonMatrix(kernel, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.HAULER:
        costMatrix = haulerCostMatrixMatrix(kernel, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.BASE_DEFENSE:
        costMatrix = createDefenderCostMatrix(this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.SOURCE_ROAD:
        costMatrix = createSourceRoadMatrix(kernel, this.roomId, trace);
        break;
      case AllowedCostMatrixTypes.OPEN_SPACE:
        [costMatrix] = createOpenSpaceMatrix(this.roomId, trace);
        break;
      default:
        trace.error('unknown cost matrix type', {type: this.costMatrixType});
    }

    this.costMatrix = costMatrix;
    this.time = Game.time;
  }

  getCostMatrix(kernel: Kernel, trace: Tracer) {
    if (!this.costMatrix || this.isExpired(Game.time)) {
      trace.info('cache miss/expired', {
        room: this.roomId,
        type: this.costMatrixType,
        expired: this.isExpired(Game.time),
      });
      this.update(kernel, trace);
    }

    return this.costMatrix;
  }

  isExpired(time) {
    return time - this.time > COST_MATRIX_TTL;
  }
}

export class CostMatrixCache {
  rooms: Map<string, Map<AllowedCostMatrixTypes, CostMatrixCacheItem>>;

  constructor() {
    this.rooms = new Map();
  }

  getCostMatrix(kernel: Kernel, roomId: string, costMatrixType: AllowedCostMatrixTypes, trace: Tracer): CostMatrix {
    if (!this.rooms.get(roomId)) {
      trace.info('room not in cache', {roomId});
      this.rooms.set(roomId, new Map());
    }

    const room = this.rooms.get(roomId);
    let roomMatrix = room.get(costMatrixType);
    if (!roomMatrix) {
      trace.info('matrix type not in room cache', {roomId, costMatrixType});
      roomMatrix = new CostMatrixCacheItem(roomId, costMatrixType);
      room.set(costMatrixType, roomMatrix);
    }

    return roomMatrix.getCostMatrix(kernel, trace);
  }

  getStats() {
    return {
      roomCacheSize: this.rooms.size,
    };
  }
}
