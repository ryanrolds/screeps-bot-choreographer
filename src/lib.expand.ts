import {Kernel} from './kernel';
import {createOpenSpaceMatrix} from './lib.costmatrix';
import {Tracer} from './lib.tracing';

const PASSES = 6;
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

  candidates: Set<string>;
  claimed: Set<string>;
  dismissed: Map<string, DismissedReason>;
  seen: Set<string>;
}

export const pickExpansion = (kernel: Kernel, trace: Tracer): ExpandResults => {
  const candidates: Set<string> = new Set();
  const claimed: Set<string> = new Set();
  const dismissed: Map<string, DismissedReason> = new Map();
  let seen: Set<string> = new Set();

  const bases = kernel.getPlanner().getBases();

  let baseRoomStatus = null;
  if (bases.length) {
    baseRoomStatus = Game.map.getRoomStatus(bases[0].primary).status;
  }

  trace.notice('base room status', {baseRoomStatus});

  // First pass through bases, find all the rooms that are assigned to a base already
  bases.forEach((base) => {
    claimed.add(base.primary);
    // Build map of claimed rooms
    base.rooms.forEach((roomName) => {
      claimed.add(roomName);
    });
  });

  let nextPass: string[] = Array.from(claimed.keys());
  seen = new Set(claimed);

  trace.info('starting expansion pass', {nextPass, maxPasses: PASSES});

  for (let i = 0; i < PASSES; i++) {
    const found = [];

    nextPass.forEach((parentRoom) => {
      _.forEach(Game.map.describeExits(parentRoom), (roomName, key) => {
        // Check room in next pass
        if (!seen.has(roomName)) {
          found.push(roomName);
        }

        seen.add(roomName);

        if (dismissed.has(roomName)) {
          return;
        }

        if (claimed.has(roomName)) {
          return;
        }

        if (baseRoomStatus !== null) {
          const roomStatus = Game.map.getRoomStatus(roomName).status;
          if (roomStatus !== baseRoomStatus) {
            trace.info('different room status', {roomName, roomStatus, baseRoomStatus});
            dismissed.set(roomName, DismissedReasonDifferentRoomStatus);
            return;
          }
        }

        const roomEntry = kernel.getScribe().getRoomById(roomName);
        if (!roomEntry) {
          trace.info('no room entry', {roomName});
          dismissed.set(roomName, DismissedReasonNoRoomEntry);
          return;
        }

        trace.info('room entry', {roomEntry});

        if (!roomEntry.controller || !roomEntry.controller.pos) {
          trace.info('dismiss candidate, no controller', {parentRoom, roomEntry});
          dismissed.set(roomName, DismissedReasonNoController);
          return;
        }

        // It room is owned by another player, we can't expand there
        // Also add to claims room list to we don't pick adjacent rooms
        if (roomEntry.controller.owner) {
          trace.info('dismissed room owned', {parentRoom, roomEntry});
          dismissed.set(roomName, DismissedReasonOwned);
          claimed.add(roomName)
          return;
        }

        // If previous room was claimed, do not build as this room is too close to another colony
        if (claimed.has(parentRoom)) {
          dismissed.set(roomName, DismissedReasonAdjacentClaimed);
          trace.info('dismissing room, parent claimed', {parentRoom, roomName});
          return;
        }

        trace.info('adding room to candidates', {roomName});
        candidates.add(roomName);
      });
    });

    nextPass = found;
  }

  trace.info('candidates', {
    candidates: Array.from(candidates.keys()),
    dismissed: Array.from(dismissed.entries())
  });

  const filterCandidates: Set<string> = new Set();
  for (const candidate of candidates.keys()) {
    if (claimed.has(candidate) || dismissed.has(candidate)) {
      continue;
    }

    filterCandidates.add(candidate);
  }

  trace.info('filtered candidates', {filterCandidates: Array.from(filterCandidates.keys())});

  // TODO factor in available remotes
  const sortedCandidates = _.sortByOrder([...filterCandidates.keys()],
    (roomName) => {
      const roomEntry = kernel.getScribe().getRoomById(roomName);
      if (!roomEntry) {
        trace.error('no room entry', {roomName});
        return 0;
      }

      trace.info('room source', {roomName, numSources: roomEntry.numSources, roomEntry});
      return roomEntry.numSources;
    },
    ['desc'],
  );

  trace.info('sorted candidates', {sortedCandidates});

  if (sortedCandidates.length < 3) {
    trace.notice('not enough candidates', {sortedCandidates});
    return {selected: null, distance: null, origin: null, candidates, claimed, dismissed, seen};
  }

  for (let i = 0; i < sortedCandidates.length; i++) {
    const roomName = sortedCandidates[i];
    const [costMatrix, distance, origin] = createOpenSpaceMatrix(roomName, trace);
    trace.info('open space matrix', {roomName, distance, origin});

    if (distance >= MIN_DISTANCE_FOR_ORIGIN) {
      return {selected: roomName, distance, origin, candidates, claimed, dismissed, seen};
    }
  }

  return {selected: null, distance: null, origin: null, candidates, claimed, dismissed, seen};
};
