import {Process, Runnable, RunnableResult, running, sleeping} from "./os.process";
import {Tracer} from './lib.tracing';
import {Kingdom} from './org.kingdom';

const RUN_INTERVAL = 1;

export default class ExpansionManager implements Runnable {
  id: string;

  constructor(id: string, trace: Tracer) {
    this.id = id;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id).begin('expansion_manager_run');

    const blocked: Record<string, boolean> = {};

    kingdom.getColonies().forEach(colony => {
      const room = colony.primaryRoom;
      blocked[room.name] = true;

      // Add rooms within 2 rooms of the primary room to blocked list
      _.forEach(Game.map.describeExits(room.name), (exit) => {
        blocked[exit] = true;

        _.forEach(Game.map.describeExits(exit), (exit) => {
          blocked[exit] = true;
        });
      });
    });

    kingdom.getColonies().forEach(colony => {
      const rooms = kingdom.getScribe().getRoomsWithinRange(colony.primaryRoomId, 4);
      trace.notice('found rooms', {colony: colony.primaryRoomId, rooms});
    });

    trace.end();

    return sleeping(RUN_INTERVAL);
  }
}
