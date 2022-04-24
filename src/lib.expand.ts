import {createOpenSpaceMatrix} from "./lib.costmatrix";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";

const PASSES = 5;
const MIN_DISTANCE_FOR_ORIGIN = 8;

export const DismissedReasonNoRoomEntry = 'no_room_entry';
export const DismissedReasonNoController = 'no_controller';
export const DismissedReasonAdjacentClaimed = 'adjacent_claimed';
export const DismissedReasonOwned = 'owned';
export const DismissedReasonDifferentRoomStatus = 'different_room_status';
export type DismissedReason = 'no_room_entry' | 'no_controller' | 'adjacent_claimed' | 'owned' | 'different_room_status';

export type ExpandResults = {
  selected: string;
  distance: number;
  origin: RoomPosition
  candidates: Record<string, boolean>;
  claimed: Record<string, boolean>;
  dismissed: Record<string, DismissedReason>;
  seen: Record<string, boolean>;
}

export const pickExpansion = (kingdom: Kingdom, trace: Tracer): ExpandResults => {
  let candidates: Record<string, boolean> = {};
  let claimed: Record<string, boolean> = {};
  let dismissed: Record<string, DismissedReason> = {};
  let seen: Record<string, boolean> = {};

  const baseConfigs = kingdom.getPlanner().getBaseConfigs();

  let baseRoomStatus = null;
  if (baseConfigs.length) {
    baseRoomStatus = Game.map.getRoomStatus(baseConfigs[0].primary).status;
  }

  trace.notice('base room status', {baseRoomStatus});

  // First pass through colonies, find all the rooms that are assigned to a colony already
  baseConfigs.forEach((baseConfig) => {
    claimed[baseConfig.primary] = true;
    // Build map of claimed rooms
    baseConfig.rooms.forEach((roomName) => {
      claimed[roomName] = true;
    });
  });

  let nextPass: string[] = Object.keys(claimed);
  seen = _.clone(claimed);

  for (let i = 0; i < PASSES; i++) {
    const found = [];

    nextPass.forEach((parentRoom) => {
      _.forEach(Game.map.describeExits(parentRoom), (roomName, key) => {
        // Check room in next pass
        if (!seen[roomName]) {
          found.push(roomName);
        }

        seen[roomName] = true;

        if (dismissed[roomName]) {
          return;
        }

        if (claimed[roomName]) {
          return;
        }

        if (baseRoomStatus !== null) {
          const roomStatus = Game.map.getRoomStatus(roomName).status;
          if (roomStatus !== baseRoomStatus) {
            trace.info('different room status', {roomName, roomStatus, baseRoomStatus});
            dismissed[roomName] = DismissedReasonDifferentRoomStatus;
            return;
          }
        }

        const roomEntry = kingdom.getScribe().getRoomById(roomName);
        if (!roomEntry) {
          trace.info('no room entry', {roomName});
          dismissed[roomName] = DismissedReasonNoRoomEntry;
          return;
        }

        trace.info('room entry', {roomEntry});

        if (!roomEntry.controller || !roomEntry.controller.pos) {
          trace.info('dismiss candidate, no controller', {parentRoom, roomEntry});
          dismissed[roomName] = DismissedReasonNoController;
          return;
        }

        // It room is owned by another player, we can't expand there
        // Also add to claims room list to we don't pick adjacent rooms
        if (roomEntry.controller.owner) {
          trace.info('dismissed room owned', {parentRoom, roomEntry});
          dismissed[roomName] = DismissedReasonOwned;
          claimed[roomName] = true;
          return;
        }

        // If previous room was claimed, do not build as this room is too close to another colony
        if (claimed[parentRoom]) {
          dismissed[roomName] = DismissedReasonAdjacentClaimed;
          trace.info('dismissing room, parent claimed', {parentRoom, roomName});
          return;
        }

        trace.info('adding room to candidates', {roomName});
        candidates[roomName] = true;
      });
    });

    nextPass = found;
  }

  let candidateList = _.keys(candidates);
  candidateList = _.filter(candidateList, (roomName) => {
    if (claimed[roomName]) {
      return false;
    }

    if (dismissed[roomName]) {
      return false;
    }

    return true;
  });

  trace.info('pre-filter candidates', {candidateList});

  // TODO factor in available remotes
  candidateList = _.sortByOrder(candidateList,
    (roomName) => {
      const roomEntry = kingdom.getScribe().getRoomById(roomName);
      if (!roomEntry) {
        trace.error('no room entry', {roomName});
        return 0;
      }

      trace.info('room source', {roomName, numSources: roomEntry.numSources, roomEntry});
      return roomEntry.numSources;
    },
    ['desc']
  );

  trace.info('sorted candidates', {candidateList});

  if (candidateList.length < 3) {
    trace.notice('not enough candidates', {candidateList});
    return {selected: null, distance: null, origin: null, candidates, claimed, dismissed, seen};
  }

  for (let i = 0; i < candidateList.length; i++) {
    const roomName = candidateList[i];
    const [costMatrix, distance, origin] = createOpenSpaceMatrix(roomName, trace);
    trace.info('open space matrix', {roomName, distance, origin});

    if (distance >= MIN_DISTANCE_FOR_ORIGIN) {
      return {selected: roomName, distance, origin, candidates, claimed, dismissed, seen};
    }
  }

  return {selected: null, distance: null, origin: null, candidates, claimed, dismissed, seen};
}
