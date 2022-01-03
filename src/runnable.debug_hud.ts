import {trace} from "console";
import {Consumer} from "./lib.event_broker";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {running} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";

const CONSUME_EVENTS_TTL = 20;

export type HudLine = {
  key: string;
  room: string;
  order: number;
  text: string;
  time: number;
}

type HudLines = Record<string, HudLine>;

export function getHudStream(): string {
  return `hud`;
}

export const HudStreamEventSet = 'set'

export class HUDRunnable {
  private id: string;
  private lines: HudLines = {};

  private hudLinesConsumer: Consumer;
  private threadConsumeEvents: ThreadFunc;

  constructor(id: string) {
    this.id = id;

    this.hudLinesConsumer = null;
    this.threadConsumeEvents = thread('consume_events', CONSUME_EVENTS_TTL)(this.consumeEvents.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    if (this.hudLinesConsumer === null) {
      const streamId = getHudStream();
      const consumer = kingdom.getBroker().getStream(streamId).addConsumer('hud');
      this.hudLinesConsumer = consumer;
    }

    this.threadConsumeEvents(trace);

    _.forEach(_.groupBy(this.lines, 'room'), (lines, room) => {
      let lineNum = 0;
      const roomVisual = new RoomVisual(room);
      lines.forEach((line) => {
        lineNum++;
        roomVisual.text(line.text, 49, lineNum, {font: 0.7, align: 'right'});
      });
    });

    return running();
  }

  consumeEvents(trace: Tracer) {
    this.hudLinesConsumer.getEvents().forEach((event) => {
      const line: HudLine = event.data;
      this.lines[line.key] = line;
    });
  }
}
