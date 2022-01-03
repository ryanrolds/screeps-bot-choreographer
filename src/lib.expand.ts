import {createOpenSpaceMatrix} from "./lib.costmatrix";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";

const MIN_DISTANCE_FOR_ORIGIN = 8;

export const DismissedReasonNoRoomEntry = 'no_room_entry';
export const DismissedReasonNoController = 'no_controller';
export const DismissedReasonAdjacentClaimed = 'adjacent_claimed';
export const DismissedReasonOwned = 'owned';
export type DismissedReason = 'no_room_entry' | 'no_controller' | 'adjacent_claimed' | 'owned';

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

  for (let i = 0; i < 4; i++) {
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

        const roomEntry = kingdom.getScribe().getRoomById(roomName);
        if (!roomEntry) {
          trace.log('no room entry', {roomName});
          dismissed[roomName] = DismissedReasonNoRoomEntry;
          return;
        }

        trace.log('room entry', {roomEntry});

        if (!roomEntry.controller || !roomEntry.controller.pos) {
          trace.log('dismiss candidate, no controller', {parentRoom, roomEntry});
          dismissed[roomName] = DismissedReasonNoController;
          return;
        }

        if (roomEntry.controller.owner) {
          trace.log('dismissed room owned', {parentRoom, roomEntry});
          dismissed[roomName] = DismissedReasonOwned;
          return;
        }

        // If previous room was claimed, do not build as this room is too close to another colony
        if (claimed[parentRoom]) {
          dismissed[roomName] = DismissedReasonAdjacentClaimed;
          trace.log('dismissing room, parent claimed', {parentRoom, roomName});
          return;
        }

        trace.log('adding room to candidates', {roomName});
        candidates[roomName] = true;
      });
    });

    nextPass = found;
  }

  let candidateList = _.keys(candidates);

  trace.log('pre-filter candidates', {candidateList});

  candidateList = _.sortByOrder(candidateList,
    (roomName) => {
      const roomEntry = kingdom.getScribe().getRoomById(roomName);
      if (!roomEntry) {
        trace.error('no room entry', {roomName});
        return 0;
      }

      trace.log('room source', {roomName, numSources: roomEntry.numSources, roomEntry});
      return roomEntry.numSources;
    },
    ['desc']
  );

  trace.log('sorted candidates', {candidateList});

  if (candidateList.length < 3) {
    trace.notice('not enough candidates', {candidateList});
    return {selected: null, distance: null, origin: null, candidates, claimed, dismissed, seen};
  }

  for (let i = 0; i < candidateList.length; i++) {
    const roomName = candidateList[i];
    const [costMatrix, distance, origin] = createOpenSpaceMatrix(roomName, trace);
    trace.log('open space matrix', {roomName, distance, origin});

    if (distance >= MIN_DISTANCE_FOR_ORIGIN) {
      return {selected: roomName, distance, origin, candidates, claimed, dismissed, seen};
    }
  }

  return {selected: null, distance: null, origin: null, candidates, claimed, dismissed, seen};
}
