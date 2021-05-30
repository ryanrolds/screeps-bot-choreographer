
import * as _ from 'lodash';
import {Scheduler, Priorities} from "./os.scheduler";
import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import Room from './org.room';
import ReactorRunnable from './runnable.reactor';
import BoosterRunnable from './runnable.booster';

export class LabsManager {
  id: string;
  orgRoom: Room;
  scheduler: Scheduler;

  labIds: Id<StructureLab>[];
  reactorsIds: Id<StructureLab>[][];
  boosterIds: Id<StructureLab>[];

  constructor(id: string, orgRoom: Room, scheduler: Scheduler, trace: Tracer) {
    this.id = id;
    this.orgRoom = orgRoom;
    this.scheduler = scheduler;

    this.labIds = [];
    this.reactorsIds = [];
    this.boosterIds = [];
    this.assignLabs(orgRoom, trace.asId(this.id));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    trace.log('labs manager run', {
      labIds: this.labIds,
      reactorsIds: this.reactorsIds,
      boosterIds: this.boosterIds,
    });

    // Compare labs in current tick to labs that went into assignment
    const labIds: Id<StructureLab>[] = this.orgRoom.getLabs().map(lab => lab.id);
    if (!_.isEqual(_.sortBy(this.labIds), _.sortBy(labIds))) {
      trace.log('labs changed - terminating', {});
      return terminate();
    }

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
        (this.orgRoom as any).booster = booster;

        this.scheduler.registerProcess(new Process(boosterId, 'boosters', Priorities.RESOURCES,
          booster));
      }
    }

    return sleeping(50);
  }

  assignLabs(orgRoom: Room, trace: Tracer) {
    const room = orgRoom.getRoomObject();
    if (!room) {
      return;
    }

    // Get list of labs in rooms
    let unassignedLabs = this.orgRoom.getLabs();
    this.labIds = unassignedLabs.map(lab => lab.id);

    trace.log('unassigned labs', {labIds: this.labIds});

    // Find lab closest to spawn
    const spawns = this.orgRoom.getSpawns();
    if (!spawns.length) {
      trace.log('no spawns');
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
  }
}
