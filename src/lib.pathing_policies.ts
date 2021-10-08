import {FindPathPolicy} from "./lib.pathing";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";

export const common: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
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
