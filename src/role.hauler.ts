
import {behaviorBoosts} from "./behavior.boosts";
import * as behaviorHaul from "./behavior.haul";
import {roadWorker} from "./behavior.logistics";
import * as behaviorMovement from "./behavior.movement";
import behaviorRoom from "./behavior.room";
import * as MEMORY from "./constants.memory";
import * as behaviorTree from "./lib.behaviortree";
import {AllowedCostMatrixTypes} from "./lib.costmatrix_cache";
import {FindPathPolicy} from "./lib.pathing";

export const haulerPolicy: FindPathPolicy = {
  room: {
    avoidHostileRooms: true,
    avoidFriendlyRooms: false,
    avoidRoomsWithKeepers: true,
    avoidRoomsWithTowers: false,
    avoidUnloggedRooms: false,
    sameRoomStatus: true,
    costMatrixType: AllowedCostMatrixTypes.HAULER,
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
    sourceKeeperBuffer: 3,
    preferRoadSites: true,
  },
};

const behavior = behaviorTree.sequenceNode(
  'haul_task',
  [
    behaviorHaul.clearTask,
    behaviorTree.selectorNode(
      'pick_something',
      [
        behaviorHaul.getHaulTaskFromBaseTopic,
        behaviorRoom.parkingLot,
      ],
    ),
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_PICKUP, 1, haulerPolicy),
    behaviorHaul.loadCreep,
    behaviorMovement.cachedMoveToMemoryObjectId(MEMORY.MEMORY_HAUL_DROPOFF, 1, haulerPolicy),
    behaviorHaul.emptyCreep,
  ],
);

export const roleHauler = {
  run: behaviorTree.rootNode('hauler', behaviorBoosts(roadWorker(behavior))),
};
