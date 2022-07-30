import {Kernel, KernelThreadFunc, threadKernel} from './kernel';
import {Consumer} from './lib.event_broker';
import {Tracer} from './lib.tracing';
import {running} from './os.process';
import {RunnableResult} from './os.runnable';

const CONSUME_EVENTS_TTL = 1;
const DASHBOARD_EVENTS_TTL = 1;

const RADIUS = 3;

export type HudLine = {
  key: string;
  room: string;
  order: number;
  text: string;
  time: number;
}

type HudLines = Map<string, HudLine>;

export function getLinesStream(): string {
  return `hud_lines`;
}

export enum HudIndicatorStatus {
  Green = 'green',
  Yellow = 'yellow',
  Red = 'red',
  Stale = 'stale'
}

export type HudIndicator = {
  key: string;
  room: string;
  display: string;
  status: HudIndicatorStatus;
}

export function getDashboardStream(): string {
  return `hud_dashboard`;
}

export const HudEventSet = 'set';

export class Dashboard {
  key: string;
  indicators: Map<string, HudIndicator>;

  constructor(key: string) {
    this.key = key;
    this.indicators = new Map();
  }

  setIndicator(indicator: HudIndicator) {
    this.indicators.set(indicator.key, indicator);
  }

  getIndicators(): Map<string, HudIndicator> {
    return this.indicators;
  }
}

export class HUDRunnable {
  private dashboards: Map<string, Dashboard> = new Map();
  private lines: HudLines = new Map();

  private dashboardConsumer: Consumer;
  private threadDashboardEvents: KernelThreadFunc;

  private hudLinesConsumer: Consumer;
  private threadLinesEvents: KernelThreadFunc;

  constructor() {
    this.dashboardConsumer = null;
    this.threadDashboardEvents = threadKernel('dashboard_events', DASHBOARD_EVENTS_TTL)(this.consumeDashboardEvents.bind(this));

    this.hudLinesConsumer = null;
    this.threadLinesEvents = threadKernel('consume_events', CONSUME_EVENTS_TTL)(this.consumeLinesEvents.bind(this));
  }

  run(kernel: Kernel, trace: Tracer): RunnableResult {
    if (!this.hudLinesConsumer) {
      const linesStreamId = getLinesStream();
      const consumer = kernel.getBroker().getStream(linesStreamId).addConsumer('hud');
      this.hudLinesConsumer = consumer;
    }

    if (!this.dashboardConsumer) {
      const dashboardStreamId = getDashboardStream();
      const consumer = kernel.getBroker().getStream(dashboardStreamId).addConsumer('hud');
      this.dashboardConsumer = consumer;
    }

    this.threadLinesEvents(trace, kernel);
    this.threadDashboardEvents(trace, kernel);

    const lines = Array.from(this.lines.values())

    _.forEach(_.groupBy(lines, 'room'), (lines, room) => {
      let lineNum = 0;
      const roomVisual = new RoomVisual(room);

      lines.forEach((line) => {
        lineNum++;
        roomVisual.text(line.text, 49, lineNum, {font: 0.7, align: 'right'});
      });
    });

    trace.info('dashboards', {dashboards: this.dashboards});

    Array.from(this.dashboards.values()).forEach((dashboard) => {
      const indicators = dashboard.getIndicators();
      trace.info('indicators', {indicators});

      let indicatorNum = 0;
      Array.from(indicators.values()).forEach((indicator) => {
        let fill = '#00ff00';
        if (indicator.status === HudIndicatorStatus.Red) {
          fill = '#ff0000';
        } else if (indicator.status === HudIndicatorStatus.Yellow) {
          fill = '#ffff00';
        }

        const position = new RoomPosition(1 + RADIUS + (2 * RADIUS * indicatorNum) + indicatorNum, 4, indicator.room);
        Game.map.visual.circle(position, {radius: RADIUS, fill});
        Game.map.visual.text(indicator.display, position, {fontSize: 5});

        indicatorNum++;
      });
    });

    return running();
  }

  consumeLinesEvents(trace: Tracer) {
    this.hudLinesConsumer.getEvents().forEach((event) => {
      const line: HudLine = event.data;
      this.lines.set(line.key, line);
    });
  }

  consumeDashboardEvents(trace: Tracer) {
    this.dashboardConsumer.getEvents().forEach((event) => {
      trace.info('event', {event});

      const indicator: HudIndicator = event.data;

      const room = indicator.room;
      if (!this.dashboards.has(room)) {
        this.dashboards.set(room, new Dashboard(room));
      }

      this.dashboards.get(room).setIndicator(indicator);
    });
  }
}
