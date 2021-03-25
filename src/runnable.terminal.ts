import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import OrgRoom from "./org.room";
import * as MEMORY from "./constants.memory"
import * as TASKS from "./constants.tasks"
import * as TOPICS from "./constants.topics"

export default class TerminalRunnable {
  orgRoom: OrgRoom;
  terminalId: Id<StructureTerminal>;
  prevTime: number;

  constructor(room: OrgRoom, terminal: StructureTerminal) {
    this.orgRoom = room;

    this.terminalId = terminal.id;
    this.prevTime = Game.time;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    return running();
  }
}
