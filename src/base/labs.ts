
import * as _ from 'lodash';
import {Tracer} from '../lib/tracing';
import {Base, getBasePrimaryRoom} from '../os/kernel/base';
import {Kernel} from '../os/kernel/kernel';
import {Process, RunnableResult, sleeping, terminate} from '../os/process';
import {Priorities, Scheduler} from '../os/scheduler';
import {BaseRoomThreadFunc, threadBaseRoom} from '../os/threads/base_room';
import BoosterRunnable from './booster';
import ReactorRunnable from './reactor';


const reactorPositions = [
  [[3, -2], [3, -1], [2, -2]], // Top right
  [[-3, 2], [-3, 1], [-2, 2]], // Bottom left
];

// TODO I flipped TR and TL so that boosting was available at RCL6, think this through at a later time
const boosterPositions = [[-3, -2], [-3, -1], [-2, -2]]; // Top left

const RUN_TTL = 20;
const ASSIGN_LABS_TTL = 20;

export class LabsManager {
  id: string;
  baseId: string;
  scheduler: Scheduler;

  reactorsIds: Id<StructureLab>[][];
  boosterIds: Id<StructureLab>[];

  threadAssignLabs: BaseRoomThreadFunc;

  constructor(baseId: string, id: string, scheduler: Scheduler, _trace: Tracer) {
    this.id = id;
    this.baseId = baseId;
    this.scheduler = scheduler;

    this.reactorsIds = [];
    this.boosterIds = [];

    this.threadAssignLabs = threadBaseRoom('assign_labs', ASSIGN_LABS_TTL)(this.assignLabs.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    trace = trace.begin('labs_manager_run');

    trace.info('labs manager run', {
      reactorsIds: this.reactorsIds,
      boosterIds: this.boosterIds,
    });

    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.info('no base config for room', {baseId: this.baseId});
      return terminate();
    }

    this.threadAssignLabs(trace, kernel, base);

    trace.end();

    return sleeping(RUN_TTL);
  }

  assignLabs(trace: Tracer, kernel: Kernel, base: Base, room: Room) {
    this.assignBasedOnPosition(kernel, base, room, trace);

    trace.info('assigned labs', {reactors: this.reactorsIds, booster: this.boosterIds});

    // Check that we have processes for reactors
    this.reactorsIds.forEach((reactorIds) => {
      const reactorId = `${reactorIds[0]}`;
      const hasProcess = this.scheduler.hasProcess(reactorId);
      if (!hasProcess) {
        trace.info('creating process for reactor', {reactorId});
        this.scheduler.registerProcess(new Process(reactorId, 'reactors', Priorities.RESOURCES,
          new ReactorRunnable(reactorId, base.id, reactorIds)));
      }
    });

    // Check that we have processes for boosters
    if (this.boosterIds.length) {
      const boosterId = `${this.boosterIds[0]}`;
      const hasProcess = this.scheduler.hasProcess(boosterId);
      if (!hasProcess) {
        trace.info('creating process for booster', {boosterId});
        const booster = new BoosterRunnable(boosterId, base.id, this.boosterIds);
        this.scheduler.registerProcess(new Process(boosterId, 'boosters', Priorities.RESOURCES,
          booster));
      }
    }
  }

  // Automated assignment of labs based on position
  assignBasedOnPosition(kernel: Kernel, base: Base, orgRoom: Room, trace: Tracer) {
    trace = trace.begin('assign_labs');

    const room = getBasePrimaryRoom(base);
    if (!room) {
      trace.end();
      return;
    }

    this.reactorsIds = [];

    const origin = base.origin;

    reactorPositions.forEach((offsets) => {
      let reactorIds = offsets.map(([x, y]): Id<StructureLab> => {
        return room.lookForAt(LOOK_STRUCTURES, origin.x + x, origin.y + y).
          find((s) => s.structureType === STRUCTURE_LAB)?.id as Id<StructureLab>;
      });
      reactorIds = reactorIds.filter((id) => id);
      reactorIds = _.sortBy(reactorIds, 'id');

      if (reactorIds.length === 3) {
        this.reactorsIds.push(reactorIds);
      }
    });

    let boosterIds = boosterPositions.map(([x, y]): Id<StructureLab> => {
      return room.lookForAt(LOOK_STRUCTURES, origin.x + x, origin.y + y).
        find((s) => s.structureType === STRUCTURE_LAB)?.id as Id<StructureLab>;
    });
    boosterIds = boosterIds.filter((id) => id);
    boosterIds = _.sortBy(boosterIds, 'id');
    if (boosterIds.length === 3) {
      this.boosterIds = boosterIds;
    }

    trace.end();
  }
}
