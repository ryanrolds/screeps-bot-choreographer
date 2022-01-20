import {BaseConfig} from "./config";
import {Consumer, Event, Stream} from "./lib.event_broker";
import {getPath, visualizePath} from "./lib.pathing";
import {roadPolicy} from "./lib.pathing_policies";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {PersistentMemory} from "./os.memory";
import {sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";
import {getLinesStream, HudLine, HudEventSet} from "./runnable.debug_hud";

const CALCULATE_LEG_TTL = 20;
const BUILD_SHORTEST_LEG_TTL = 40;
const CONSUME_EVENTS_TTL = 30;
const PRODUCE_EVENTS_TTL = 30;

// More sites means more spent per load on road construction & maintenance
const MAX_ROAD_SITES = 5;

export const getLogisticsTopic = (colonyId: string): string => `${colonyId}_logistics`;

export enum LogisticsEventType {
  RequestRoad = "request_road",
}

export type LogisticsEventData = {
  id: string,
  position?: RoomPosition; // Required when event type is request road
};

type Leg = {
  id: string;
  destination: RoomPosition;
  path: RoomPosition[];
  remaining: RoomPosition[];
  requestedAt: number;
  updatedAt: number;
};

export default class LogisticsRunnable extends PersistentMemory {
  private colonyId: string;
  private legs: Record<string, Leg>;
  private selectedLeg: Leg | null;
  private passes: number;

  private threadConsumeEvents: ThreadFunc;
  private threadProduceEvents: ThreadFunc;
  //threadBuildRoads: ThreadFunc;
  private calculateLegIterator: Generator<any, void, {kingdom: Kingdom, trace: Tracer}>;
  private threadCalculateLeg: ThreadFunc;
  private threadBuildShortestLeg: ThreadFunc;
  private threadEnsureWallPassage: ThreadFunc;
  private logisticsStreamConsumer: Consumer;

  constructor(colonyId: string) {
    super(colonyId);

    this.colonyId = colonyId;
    this.legs = {};
    this.selectedLeg = null;
    this.passes = 0;

    this.logisticsStreamConsumer = null;
    this.threadConsumeEvents = thread('consume_events', CONSUME_EVENTS_TTL)(this.consumeEvents.bind(this));

    // Iterate through all destinations and calculate the remaining roads to build
    this.calculateLegIterator = this.calculateLegGenerator();
    this.threadCalculateLeg = thread('calculate_leg', CALCULATE_LEG_TTL)((trace: Tracer, kingdom: Kingdom) => {
      this.calculateLegIterator.next({trace, kingdom});
    });

    // From the calculated legs, select shortest to build and build it
    this.threadBuildShortestLeg = thread('select_leg', BUILD_SHORTEST_LEG_TTL)(this.buildShortestLeg.bind(this));
    // Walls may be built that block access to sources, check and remove any walls along the path and replace with road
    this.threadEnsureWallPassage = thread('ensure_wall_passage', BUILD_SHORTEST_LEG_TTL)(this.ensureWallPassage.bind(this));

    this.threadProduceEvents = thread('produce_events', PRODUCE_EVENTS_TTL)(this.produceEvents.bind(this));
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Setup the stream consumer
    if (this.logisticsStreamConsumer === null) {
      const streamId = getLogisticsTopic(this.colonyId);
      this.logisticsStreamConsumer = kingdom.getBroker().getStream(streamId).
        addConsumer('logistics');
    }

    const baseConfig = kingdom.getPlanner().getBaseConfigById(this.colonyId);
    if (!baseConfig) {
      trace.error('missing origin', {id: this.colonyId});
      return sleeping(20);
    }

    this.threadConsumeEvents(trace, kingdom);

    if (baseConfig.automated) {
      this.threadCalculateLeg(trace, kingdom);
      this.threadBuildShortestLeg(trace, baseConfig.primary);
      this.threadEnsureWallPassage(trace);
    }

    this.threadProduceEvents(trace, kingdom, baseConfig);

    // CLEANUP add LOG_WHEN_PID_CHECK
    if (this.selectedLeg) {
      visualizePath(this.selectedLeg.path, trace);
    }

    visualizeLegs(Object.values(this.legs), trace);

    return sleeping(1)
  }

  private consumeEvents(trace: Tracer, kingdom: Kingdom) {
    this.logisticsStreamConsumer.getEvents().forEach((event) => {
      switch (event.type) {
        case LogisticsEventType.RequestRoad:
          this.requestRoad(kingdom, event.data.id, event.data.position, event.time, trace);
          break;
      }
    });
  }

  private produceEvents(trace: Tracer, kingdom: Kingdom, baseConfig: BaseConfig): void {
    const hudLine: HudLine = {
      key: `${this.colonyId}`,
      room: baseConfig.primary,
      text: `Logistics - passes: ${this.passes}, legs: ${Object.keys(this.legs).length}, ` +
        `selected: ${this.selectedLeg?.id}, numRemaining: ${this.selectedLeg?.remaining.length}, ` +
        `end: ${this.selectedLeg?.remaining?.slice(-3, 0)}`,
      time: Game.time,
      order: 5,
    };

    kingdom.getBroker().getStream(getLinesStream()).publish(new Event(this.colonyId, Game.time,
      HudEventSet, hudLine));
  }

  private requestRoad(kingdom: Kingdom, id: string, destination: RoomPosition, time: number, trace: Tracer) {
    if (this.legs[id]) {
      const leg = this.legs[id];
      leg.destination = destination;
      leg.requestedAt = time;
    } else {
      const leg: Leg = {
        id,
        destination,
        path: null,
        remaining: [],
        requestedAt: time,
        updatedAt: null,
      };
      this.legs[id] = leg;
    }
  }

  private *calculateLegGenerator(): Generator<any, void, {kingdom: Kingdom, trace: Tracer}> {
    let legs: Leg[] = [];
    while (true) {
      const details: {kingdom: Kingdom, trace: Tracer} = yield;
      const kingdom = details.kingdom;
      const trace = details.trace;

      if (!legs.length) {
        trace.log('updating legs to calculate');
        legs = this.getLegsToCalculate(trace);

        if (!legs.length) {
          trace.log('no legs to calculate');
          continue;
        }
      }

      trace.log('lets to update', {
        legs: legs.map((l) => {
          return {id: l.id, updatedAt: l.updatedAt, remaining: l.remaining.length}
        })
      });

      const leg = legs.shift();
      if (leg) {
        const [path, remaining] = this.calculateLeg(kingdom, leg, trace);
        leg.path = path || [];
        leg.remaining = remaining || [];
        leg.updatedAt = Game.time;
      }

      if (!legs.length) {
        this.passes += 1;
        trace.log('pass completed', {passes: this.passes});
      }
    }
  }

  private getLegsToCalculate(trace: Tracer): Leg[] {
    return Object.values(this.legs);
  }

  private calculateLeg(kingdom: Kingdom, leg: Leg, trace: Tracer): [path: RoomPosition[], remaining: RoomPosition[]] {
    trace.log('updating leg', {leg});

    const baseConfig = kingdom.getPlanner().getBaseConfigById(this.colonyId);
    if (!baseConfig) {
      trace.error('missing origin', {id: this.colonyId});
      return [null, null];
    }

    const [pathResult, details] = getPath(kingdom, baseConfig.origin, leg.destination, roadPolicy, trace);
    trace.log('path result', {origin: baseConfig.origin, dest: leg.destination, pathResult});

    if (!pathResult) {
      trace.error('path not found', {origin: baseConfig.origin, dest: leg.destination});
      return [null, null];
    }

    const remaining = pathResult.path.filter((pos: RoomPosition) => {
      // Do not count edges as we cannot build on them
      if (pos.x === 0 || pos.y === 0 || pos.x === 49 || pos.y === 49) {
        return false;
      }

      const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });

      if (road) {
        trace.log('road found', {road});
        return false;
      }

      return true;
    });

    trace.log('remaining', {leg});

    return [pathResult.path, remaining];
  }

  private ensureWallPassage(trace: Tracer) {
    const legs: Leg[] = _.values(this.legs);

    const unfinishedLegs: Leg[] = legs.filter((leg: Leg) => {
      return leg.remaining.length > 0;
    });

    trace.log('unfinished legs', {unfinishedLegs});

    unfinishedLegs.forEach((leg) => {
      for (let i = 0; i < leg.path.length; i++) {
        const pos = leg.path[i];

        // Check if wall is present and remove
        const wall = pos.lookFor(LOOK_STRUCTURES).find((s) => {
          return s.structureType === STRUCTURE_WALL;
        });
        if (wall) {
          trace.log('remove wall', {pos});
          wall.destroy();
        }

        // Check if wall site is to be built and remove
        const wallSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
          return s.structureType === STRUCTURE_WALL;
        });
        if (wallSite) {
          trace.log('remove wall site', {pos});
          wallSite.remove();
        }

        // If there was a wall site or if we have not built too many road sites, build a road site
        if (wall || wallSite) {
          trace.log('build road site', {pos});
          const result = pos.createConstructionSite(STRUCTURE_ROAD);
          if (result !== OK) {
            trace.error('failed to build road', {pos, result});
            continue;
          }
        }
      }
    });
  }

  private buildShortestLeg(trace: Tracer, primaryRoom: string) {
    if (this.passes < 1) {
      trace.log('calculate all legs at least once before building shortest leg', {passes: this.passes});
      return;
    }

    trace.log('legs', {legs: this.legs});

    // Find shortest unfinished leg
    const legs: Leg[] = _.values(this.legs);
    const unfinishedLegs: Leg[] = legs.filter((leg: Leg) => {
      return leg.remaining.length > 0;
    });
    const sortedLegs: Leg[] = _.sortByAll(unfinishedLegs,
      (leg) => {
        // Sort sources in the primary room first
        if (leg.destination.roomName === primaryRoom) {
          return 0
        }

        return 1;
      },
      (leg) => {
        return leg.remaining.length;
      }
    );

    const leg = sortedLegs.shift();
    if (!leg) {
      trace.log('no legs to build');
      return;
    }

    trace.log('shortest leg', {leg})

    this.selectedLeg = leg;

    let roadSites = 0;
    for (let i = 0; i < leg.path.length; i++) {
      const pos = leg.path[i];

      // Do not build on edges
      if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
        trace.log('skip border site', {pos});
        continue;
      }

      // Check if road is already present
      const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });
      if (road) {
        continue;
      }

      // Check if road is already planned
      const roadSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });
      if (roadSite) {
        roadSites += 1;
        continue;
      }

      // Check if wall is present and remove
      const wall = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_WALL;
      });
      if (wall) {
        trace.log('remove wall', {pos});
        wall.destroy();
      }

      // Check if wall site is to be built and remove
      const wallSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
        return s.structureType === STRUCTURE_WALL;
      });
      if (wallSite) {
        trace.log('remove wall site', {pos});
        wallSite.remove();
      }

      // If there was a wall site or if we have not built too many road sites, build a road site
      if (wall || wallSite || roadSites <= MAX_ROAD_SITES) {
        trace.log('build road site', {pos});
        const result = pos.createConstructionSite(STRUCTURE_ROAD);
        if (result !== OK) {
          trace.error('failed to build road', {pos, result});
          continue;
        }

        trace.log('built road', {pos});
        roadSites += 1;
      }
    }
  }
}

const visualizeLegs = (legs: Leg[], trace: Tracer) => {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    new RoomVisual(leg.destination.roomName).text('X', leg.destination.x, leg.destination.y);
  }
}
