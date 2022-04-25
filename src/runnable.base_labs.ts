
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
  [[3, -2], [3, -1], [2, -2]], // Top right
  [[-3, 2], [-3, 1], [-2, 2]], // Bottom left
];

// TODO I flipped TR and TL so that boosting was available at RCL6, think this through at a later time
const boosterPositions = [[-3, -2], [-3, -1], [-2, -2]]; // Top left

const RUN_TTL = 20;
const ASSIGN_LABS_TTL = 20;

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

    trace.log('labs manager run', {
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

  assignLabs(trace: Tracer, kingdom: Kingdom, base: BaseConfig, orgRoom: Room) {


    if (base.automated) {
      trace.info('automated base, assigning labs by position');
      this.assignBasedOnPosition(kingdom, base, orgRoom, trace);
    } else {
      // Organic bases assign role by distance from related structures
      trace.info('organic base, assigning labs by distance');
      this.assignBasedOnDistance(kingdom, orgRoom, trace);
    }

    trace.info('assigned labs', {reactors: this.reactorsIds, booster: this.boosterIds});

    // Check that we have processes for reactors
    this.reactorsIds.forEach((reactorIds) => {
      const reactorId = `${reactorIds[0]}`;
      const hasProcess = this.scheduler.hasProcess(reactorId);
      if (!hasProcess) {
        trace.info('creating process for reactor', {reactorId});
        this.scheduler.registerProcess(new Process(reactorId, 'reactors', Priorities.RESOURCES,
          new ReactorRunnable(reactorId, base.id, this.orgRoom, reactorIds)));
      }
    });

    // Check that we have processes for boosters
    if (this.boosterIds.length) {
      const boosterId = `${this.boosterIds[0]}`;
      const hasProcess = this.scheduler.hasProcess(boosterId);
      if (!hasProcess) {
        trace.info('creating process for booster', {boosterId});
        const booster = new BoosterRunnable(boosterId, base.id, this.orgRoom, this.boosterIds);
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

    this.reactorsIds = [];

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

    activeIds = _.filter(activeIds, (id) => {
      if (this.boosterIds.indexOf(id) !== -1) {
        return false;
      }

      for (let i = 0; i < this.reactorsIds.length; i++) {
        if (this.reactorsIds[i].indexOf(id) !== -1) {
          return false;
        }
      }

      return true;
    });

    trace.info('active unassigned labs', {labIds: activeIds});

    if (activeIds.length === 0) {
      trace.info('no unassigned active labs, no need to reassign')
      trace.end();
      return;
    }

    this.reactorsIds = [];

    // Find lab closest to spawn
    const spawns = this.orgRoom.getSpawns();
    if (!spawns.length) {
      trace.info('no spawns');
      trace.end();
      return;
    }

    // TODO support multiple spawns
    const primaryBooster: any = _.sortBy(spawns[0].pos.findInRange(activeLabs, 3), 'id').shift();
    if (primaryBooster) {
      // TODO change range to 2 to support having more than 3 labs in a booster
      let boosterLabs: StructureLab[] = _.sortBy(primaryBooster.pos.findInRange(activeLabs, 2), 'id');
      if (boosterLabs.length >= 3) {
        this.boosterIds = boosterLabs.map(lab => lab.id);
        trace.log('booster labs', {boosterIds: this.boosterIds});
      }

      // Remove booster labs from unassigned labs
      activeLabs = _.difference(activeLabs, boosterLabs);
    }

    if (room.storage) {
      // While we have at least 3 labs, create a reactor
      while (activeLabs.length >= 3) {
        trace.info('unassigned labs', {labIds: activeLabs.map(lab => lab.id)});

        const primaryReactor: any = _.sortBy(room.storage.pos.findInRange(activeLabs, 3), 'id').shift();
        if (!primaryReactor) {
          break;
        }

        let reactorLabs: StructureLab[] = _.sortBy(primaryReactor.pos.findInRange(activeLabs, 1), 'id');
        if (reactorLabs.length >= 3) {
          reactorLabs = reactorLabs.slice(0, 3);
        }

        if (reactorLabs.length) {
          const labIds = reactorLabs.map(lab => lab.id);
          trace.info('forming reactor', {labIds});
          this.reactorsIds.push(labIds);
        }

        // Remove reactor labs from unassigned labs
        activeLabs = _.difference(activeLabs, reactorLabs);
      }
    }

    trace.end();
  }
}
