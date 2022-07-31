import {addRoom, Base, getBasePrimaryRoom, removeRoom, resetRemotes} from "./base";
import {Kernel} from "./kernel";
import {Consumer} from "./lib.event_broker";
import {checkRoom, desiredRemotes, findRemotes} from "./lib.remote_room";
import {Tracer} from "./lib.tracing";
import {sleeping, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";
import {getBaseSpawnUtilizationTopic, SpawnUtilizationUpdate} from "./runnable.base_spawning";

const RUN_INTERVAL = 200;

export class RemotesManager implements Runnable {
  private baseId: string;
  private spawnUtilizationConsumer: Consumer;
  private spawnUtilization: number;

  private roomCheckIterator: Generator<any, void, {kernel: Kernel, base: Base, trace: Tracer}>;

  constructor(baseId: string) {
    this.baseId = baseId;
    this.spawnUtilizationConsumer = null;
    this.spawnUtilization = -1;
    this.roomCheckIterator = this.roomCheckGenerator();
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('base not found', {baseId: this.baseId});
      return terminate();
    }

    if (!this.spawnUtilizationConsumer) {
      const topic = getBaseSpawnUtilizationTopic(base.id);
      this.spawnUtilizationConsumer = kernel.getBroker().getStream(topic).addConsumer(this.baseId);
    }

    // Update
    this.processEvents(kernel, base, trace);
    this.updateRemotes(kernel, base, trace);

    // Check if a room should be removed
    this.roomCheckIterator.next({kernel, base, trace});

    return sleeping(RUN_INTERVAL);
  }

  // Process events from the spawn utilization topic
  private processEvents(kernel: Kernel, base: Base, trace: Tracer): void {
    const events = this.spawnUtilizationConsumer.getEvents();
    for (const event of events) {
      this.spawnUtilization = (event.data as SpawnUtilizationUpdate).utilization;
      trace.info('spawn utilization', {spawnUtilization: this.spawnUtilization});
    }
  }

  // Update base rooms/remotes based on the current situation
  private updateRemotes(kernel: Kernel, base: Base, trace: Tracer): void {
    if (this.spawnUtilization === -1) {
      trace.warn('spawn utilization not set');
      return;
    }

    const primaryRoom = getBasePrimaryRoom(base);
    if (!primaryRoom) {
      trace.warn('primary room not found', {roomName: base.primary});
      return;
    }

    const level = primaryRoom?.controller?.level || 0;
    const numDesired = desiredRemotes(base, level, this.spawnUtilization);
    if (numDesired === 0) {
      trace.info('no remotes desired', {base: base.id, level: level});
      return;
    }

    resetRemotes(base, trace);

    const [remotes, debug] = findRemotes(kernel, base, trace);
    if (remotes.length === 0) {
      trace.info('no remotes found', {base: base.id, level: level});
      return;
    }

    trace.info('found remotes', {base: base.id, level: level, numDesired, remotes: remotes, debug: debug});

    for (let i = 0; i < Math.min(numDesired, remotes.length); i++) {
      addRoom(base, remotes[i], trace);
    }
  }

  private * roomCheckGenerator(): Generator<any, void, {kernel: Kernel, base: Base, trace: Tracer}> {
    let rooms: string[] = [];
    while (true) {
      const details: {kernel: Kernel, base: Base, trace: Tracer} = yield;
      const kernel = details.kernel;
      const base = details.base;
      const trace = details.trace;

      if (rooms.length === 0) {
        trace.info('starting new pass', {base});
        rooms = _.without([...base.rooms], base.primary);
      }

      trace.info('check remote mining', {rooms});

      const roomName = rooms.shift();
      trace.info('checking next room', {roomName});
      if (!checkRoom(kernel, base, roomName, trace)) {
        removeRoom(base, roomName, trace);
      }
    }
  }
}
