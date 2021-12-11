import {Process, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {Priorities, Scheduler} from "./os.scheduler";
import ObserverRunnable from "./runnable.observer";

export default class ColonyRunnable {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.as('colony_run');

    // TODO we maybe should not depend on getting the colony from the kingdom
    // TODO switch to central planning
    const colony = kingdom.getPlanner().getColonyConfigById(this.id);
    if (!colony) {
      trace.error('missing colony', {id: this.id});
      return terminate();
    }

    trace.log("colony config", {colony});

    const room = Game.rooms[colony.primary];
    if (!room) {
      return sleeping(20);
    }

    const observerStructures = room.find<StructureObserver>(FIND_MY_STRUCTURES, {
      filter: (structure) => {
        return structure.structureType === STRUCTURE_OBSERVER;
      },
    });

    if (observerStructures.length) {
      const observerId = observerStructures[0].id;
      const hasProcess = this.scheduler.hasProcess(observerId);
      if (!hasProcess) {
        this.scheduler.registerProcess(new Process(observerId, 'observer', Priorities.EXPLORATION,
          new ObserverRunnable(observerId)));
      }
    }

    return sleeping(20);
  }
}
