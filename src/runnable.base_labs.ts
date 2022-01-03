
import * as _ from 'lodash';
import {BaseConfig} from './config';
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import Room from './org.room';
import {Process, sleeping, terminate} from "./os.process";
import {RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from "./os.scheduler";
import {thread, ThreadFunc} from './os.thread';
import BoosterRunnable from './runnable.base_booster';
import ReactorRunnable from './runnable.base_reactor';


const reactorPositions = [
  [[-3, -2], [-3, -1], [-2, -2]],
  [[-3, 2], [-3, 1], [-2, 2]],
];

const boosterPositions = [[3, -2], [3, -1], [2, -2]];

const RUN_TTL = 50;
const ASSIGN_LABS_TTL = 200;

export class LabsManager {
  id: string;
  orgRoom: Room;
  scheduler: Scheduler;

  reactorsIds: Id<StructureLab>[][];
  boosterIds: Id<StructureLab>[];

  threadAssignLabs: ThreadFunc;

  constructor(id: string, orgRoom: Room, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.orgRoom = orgRoom;
    this.scheduler = scheduler;

    this.reactorsIds = [];
    this.boosterIds = [];

    this.threadAssignLabs = thread('assign_labs', ASSIGN_LABS_TTL)(this.assignLabs.bind(this))
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('labs_manager_run');

    trace.notice('labs manager run', {
      reactorsIds: this.reactorsIds,
      boosterIds: this.boosterIds,
    });

    const baseConfig = kingdom.getPlanner().getBaseConfigByRoom(this.orgRoom.id);
    if (!baseConfig) {
      trace.log('no base config for room', {room: this.orgRoom.id});
      return terminate();
    }

    this.threadAssignLabs(trace, kingdom, baseConfig, this.orgRoom);

    trace.end();

    return sleeping(RUN_TTL);
  }


  assignLabs(trace: Tracer, kingdom: Kingdom, baseConfig: BaseConfig, orgRoom: Room) {
    if (baseConfig.automated) {
      this.assignBasedOnPosition(kingdom, baseConfig, orgRoom, trace);
    } else {
      this.assignBasedOnDistance(kingdom, orgRoom, trace);
    }

    trace.notice('assigned labs', {reactors: this.reactorsIds, booster: this.boosterIds});

    // Compare labs in current tick to labs that went into assignment
    const labIds: Id<StructureLab>[] = this.orgRoom.getLabs().map(lab => lab.id);

    // Check that we have processes for reactors
    this.reactorsIds.forEach((reactorIds) => {
      const reactorId = `${reactorIds[0]}`;
      const hasProcess = this.scheduler.hasProcess(reactorId);
      if (!hasProcess) {
        this.scheduler.registerProcess(new Process(reactorId, 'reactors', Priorities.RESOURCES,
          new ReactorRunnable(reactorId, this.orgRoom, reactorIds)));
      }
    });

    // Check that we have processes for boosters
    if (this.boosterIds.length) {
      const boosterId = `${this.boosterIds[0]}`;
      const hasProcess = this.scheduler.hasProcess(boosterId);
      if (!hasProcess) {
        const booster = new BoosterRunnable(boosterId, this.orgRoom, this.boosterIds);
        this.scheduler.registerProcess(new Process(boosterId, 'boosters', Priorities.RESOURCES,
          booster));
      }
    }
  }

  // Automated assignment of labs based on position
  assignBasedOnPosition(kingdom: Kingdom, baseConfig: BaseConfig, orgRoom: Room, trace: Tracer) {
    trace = trace.begin('assign_labs');

    const room = orgRoom.getRoomObject();
    if (!room) {
      trace.end();
      return;
    }

    const origin = baseConfig.origin;

    reactorPositions.forEach((offsets) => {
      let reactorIds = offsets.map(([x, y]): Id<StructureLab> => {
        return room.lookForAt(LOOK_STRUCTURES, origin.x + x, origin.y + y).
          find(s => s.structureType === STRUCTURE_LAB)?.id as Id<StructureLab>;
      })
      reactorIds = reactorIds.filter(id => id);
      reactorIds = _.sortBy(reactorIds, 'id');

      if (reactorIds.length === 3) {
        this.reactorsIds.push(reactorIds);
      }
    });

    let boosterIds = boosterPositions.map(([x, y]): Id<StructureLab> => {
      return room.lookForAt(LOOK_STRUCTURES, origin.x + x, origin.y + y).
        find(s => s.structureType === STRUCTURE_LAB)?.id as Id<StructureLab>;
    })
    boosterIds = boosterIds.filter(id => id);
    boosterIds = _.sortBy(boosterIds, 'id');
    if (boosterIds.length === 3) {
      this.boosterIds = boosterIds;
    }

    trace.end();
  }

  // Non-automated assignment based on proximity to spawns and storage
  assignBasedOnDistance(kingdom: Kingdom, orgRoom: Room, trace: Tracer) {
    trace = trace.begin('assign_labs');

    const room = orgRoom.getRoomObject();
    if (!room) {
      trace.end();
      return;
    }

    // Get list of active labs in rooms
    let unassignedLabs = this.orgRoom.getLabs();
    let activeLabs = _.filter(unassignedLabs, lab => lab.isActive());
    let activeIds = activeLabs.map(lab => lab.id);

    trace.log('active unassigned labs', {labIds: activeIds});

    // Find lab closest to spawn
    const spawns = this.orgRoom.getSpawns();
    if (!spawns.length) {
      trace.log('no spawns');
      trace.end();
      return;
    }

    // TODO support multiple spawns
    const primaryBooster: any = _.sortBy(spawns[0].pos.findInRange(unassignedLabs, 3), 'id').shift();
    if (primaryBooster) {
      // TODO change range to 2 to support having more than 3 labs in a booster
      let boosterLabs: StructureLab[] = _.sortBy(primaryBooster.pos.findInRange(unassignedLabs, 2), 'id');
      if (boosterLabs.length >= 3) {
        this.boosterIds = boosterLabs.map(lab => lab.id);
        trace.log('booster labs', {boosterIds: this.boosterIds});
      }

      // Remove booster labs from unassigned labs
      unassignedLabs = _.difference(unassignedLabs, boosterLabs);
    }

    if (room.storage) {
      // While we have at least 3 labs, create a reactor
      while (unassignedLabs.length >= 3) {
        const primaryReactor: any = _.sortBy(room.storage.pos.findInRange(unassignedLabs, 3), 'id').shift();
        if (!primaryReactor) {
          break;
        }

        let reactorLabs: StructureLab[] = _.sortBy(primaryReactor.pos.findInRange(unassignedLabs, 1), 'id');
        if (reactorLabs.length >= 3) {
          reactorLabs = reactorLabs.slice(0, 3);
        }

        // Remove reactor labs from unassigned labs
        unassignedLabs = _.difference(unassignedLabs, reactorLabs);

        if (reactorLabs.length) {
          const labIds = reactorLabs.map(lab => lab.id);
          trace.log('forming reactor', {labIds});
          this.reactorsIds.push(labIds);
        }
      }
    }

    trace.end();
  }
}
