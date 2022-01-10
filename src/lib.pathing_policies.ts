import {FindPathPolicy} from "./lib.pathing";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";

export const commonPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.COMMON,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 12,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
  },
};

export const singleRoomPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.SINGLE_ROOM_COMMON,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 1,
    maxOps: 1000,
    maxPathRooms: 1,
    ignoreCreeps: true,
  },
};

export const roadPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.SOURCE_ROAD,
  },
  destination: {
    range: 1,
  },
  path: {
    allowIncomplete: true,
    maxSearchRooms: 12,
    maxOps: 5000,
    maxPathRooms: 6,
    ignoreCreeps: true,
  },
};
