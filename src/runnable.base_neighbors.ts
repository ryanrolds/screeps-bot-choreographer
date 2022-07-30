import {Base} from "./base";
import {Kernel} from "./kernel";
import {Tracer} from "./lib.tracing";
import {sleeping, terminate} from "./os.process";
import {Runnable, RunnableResult} from "./os.runnable";

const RUN_INTERVAL = 100;


export class NeighborsRunnable implements Runnable {
  private baseId: string;

  constructor(baseId: string) {
    this.baseId = baseId;
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    const base = kernel.getPlanner().getBaseById(this.baseId);
    if (!base) {
      trace.error('base not found', {baseId: this.baseId});
      return terminate();
    }

    if (!base.walls.length) {
      this.updateNeighbors(kernel, base, trace);
    }

    return sleeping(RUN_INTERVAL)
  }

  private updateNeighbors(kernel: Kernel, currentBase: Base, trace: Tracer) {
    // Narrow bases to ones that are nearby
    let nearbyBases = _.filter(kernel.getPlanner().getBases(), (base) => {
      if (currentBase.id === base.id) {
        return false;
      }

      const distance = Game.map.getRoomLinearDistance(currentBase.primary, base.primary);
      if (distance > 5) {
        return false;
      }

      // RAKE calculate path check number of rooms in path, factoring in enemy rooms

      return true;
    });

    // Sort by distance
    nearbyBases = _.sortBy(nearbyBases, (base) => {
      return Game.map.getRoomLinearDistance(currentBase.primary, base.primary);
    });

    // Pick at most nearest 3
    nearbyBases = _.take(nearbyBases, 3);

    // Set bases neighbors
    currentBase.neighbors = nearbyBases.map((base) => base.id);

    trace.info('updated neighbors', {base: currentBase});
  }
}
