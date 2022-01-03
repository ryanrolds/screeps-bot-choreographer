import {Tracer} from './lib.tracing';
import {Kingdom} from "./org.kingdom";
import {Observer} from "./org.observer";
import {running, terminate} from "./os.process";
import {RunnableResult} from "./os.runnable";

export default class ObserverRunnable {
  id: Id<StructureObserver>;
  observer: Observer;

  constructor(id: Id<StructureObserver>) {
    this.id = id;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.as('observer_run');

    const structure = Game.getObjectById(this.id);
    if (!structure) {
      trace.error('missing structure', {id: this.id});
      return terminate();
    }

    if (!this.observer) {
      this.observer = new Observer(kingdom, structure, trace);
    }

    this.observer.update(trace);
    this.observer.process(trace);

    return running();
  }
}
