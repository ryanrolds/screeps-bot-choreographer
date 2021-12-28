
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';
import {Process, running} from "./os.process";
import {RunnableResult} from './os.runnable';
import {Priorities, Scheduler} from "./os.scheduler";
import RoomRunnable from './runnable.room';


export class RoomManager {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.begin('room_run');
    trace.log('room manager run');

    Object.entries(Game.rooms).forEach(([name, room]) => {
      const hasProcess = this.scheduler.hasProcess(name);
      if (hasProcess) {
        return;
      }

      if (!kingdom.getRoomByName(name)) {
        trace.log('not a room we assert within our domain', {name});
        return;
      }

      trace.log('room we assert domain over without process, starting', {name});

      this.scheduler.registerProcess(new Process(name, 'room', Priorities.RESOURCES,
        new RoomRunnable(name, this.scheduler)));
    });


    trace.end();

    return running();
  }
}
