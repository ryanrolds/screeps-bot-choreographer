import path from "path";
import {Consumer, Stream} from "./lib.event_broker";
import {getPath, visualizePath} from "./lib.pathing";
import {roadPolicy} from "./lib.pathing_policies";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {PersistentMemory} from "./os.memory";
import {sleeping} from "./os.process";
import {RunnableResult} from "./os.runnable";
import {thread, ThreadFunc} from "./os.thread";

const CALCULATE_LEG_TTL = 20;
const BUILD_SHORTEST_LEG_TTL = 40;
const CONSUME_EVENTS_TTL = 30;

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

type Destinations = (Source | Mineral | StructureController);

type Leg = {
  id: string;
  destination: RoomPosition;
  path: RoomPosition[];
  remaining: number;
  requestedAt: number;
};

export default class LogisticsRunnable extends PersistentMemory {
  private colonyId: string;
  private legs: Record<string, Leg>;
  private selectedLeg: Leg | null;
  private passes: number;

  private threadConsumeEvents: ThreadFunc;
  //threadBuildRoads: ThreadFunc;
  private calculateLegIterator: Generator<any, void, {kingdom: Kingdom, trace: Tracer}>;
  private threadCalculateLeg: ThreadFunc;
  private threadBuildShortestLeg: ThreadFunc;
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
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    // Setup the stream consumer
    if (this.logisticsStreamConsumer === null) {
      const streamId = getLogisticsTopic(this.colonyId);
      this.logisticsStreamConsumer = kingdom.getBroker().getStream(streamId).
        addConsumer('logistics');
    }

    const colonyConfig = kingdom.getPlanner().getColonyConfigById(this.colonyId);
    if (!colonyConfig) {
      trace.error('missing origin', {id: this.colonyId});
      return sleeping(20);
    }

    this.threadConsumeEvents(trace, kingdom);
    this.threadCalculateLeg(trace, kingdom);
    this.threadBuildShortestLeg(trace, colonyConfig.primary);

    // CLEANUP add LOG_WHEN_ID_CHECK
    if (this.selectedLeg) {
      visualizePath(this.selectedLeg.path, trace);
    }

    visualizeLegs(Object.values(this.legs), trace);

    trace.notice('selected', {leg: this.selectedLeg});
    trace.notice('legs', {legs: this.legs})

    return sleeping(1)
  }

  private consumeEvents(trace: Tracer, kingdom: Kingdom) {
    this.logisticsStreamConsumer.getEvents().forEach((event) => {
      trace.notice('event', {event});

      switch (event.type) {
        case LogisticsEventType.RequestRoad:
          this.requestRoad(kingdom, event.data.id, event.data.position, event.time, trace);
          break;
      }
    });
  }

  private requestRoad(kingdom: Kingdom, id: string, destination: RoomPosition, time: number, trace: Tracer) {
    trace.notice('request_road', {id, destination, time});

    if (this.legs[id]) {
      const leg = this.legs[id];
      leg.destination = destination;
      leg.requestedAt = time;
    } else {
      const leg: Leg = {
        id,
        destination,
        path: null,
        remaining: null,
        requestedAt: time,
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
        legs = this.getLegsToCalculate(trace);

        if (!legs.length) {
          trace.notice('no destinations');
          continue;
        }
      }

      const leg = legs.shift();
      if (leg) {
        const [path, remaining] = this.calculateLeg(kingdom, leg, trace);
        leg.path = path;
        leg.remaining = remaining;
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

  private calculateLeg(kingdom: Kingdom, leg: Leg, trace: Tracer): [path: RoomPosition[], remaining: number] {
    const colonyConfig = kingdom.getPlanner().getColonyConfigById(this.colonyId);
    if (!colonyConfig) {
      trace.error('missing origin', {id: this.colonyId});
      return [null, null];
    }

    const [pathResult, details] = getPath(kingdom, colonyConfig.origin, leg.destination, roadPolicy, trace);
    trace.log('path found', {origin: colonyConfig.origin, dest: leg.destination, pathResult});

    if (!pathResult) {
      trace.error('path not found', {origin: colonyConfig.origin, dest: leg.destination});
      return [null, null];
    }

    const remaining = pathResult.path.reduce((acc: number, pos: RoomPosition) => {
      // Do not count edges as we cannot build on them
      if (pos.x === 0 || pos.y === 0 || pos.x === 49 || pos.y === 49) {
        return acc;
      }

      const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });

      if (road) {
        trace.log('road found', {road});
        return acc;
      }

      acc += 1;

      return acc;
    }, 0);

    trace.notice("calculated leg", {remaining, path: pathResult.path});
    return [pathResult.path, remaining];
  }

  private buildShortestLeg(trace: Tracer, primaryRoom: string) {
    trace.notice('passes', {passes: this.passes})

    if (this.passes < 1) {
      trace.error('calculate all legs at least once before building shortest leg', {passes: this.passes});
      return;
    }

    // Find shortest unfinished leg
    const legs: Leg[] = _.values(this.legs);
    const unfinishedLegs: Leg[] = legs.filter((leg: Leg) => {
      return leg.remaining > 0;
    });
    const sortedLegs: Leg[] = _.sortByAll(unfinishedLegs,
      (leg) => {
        // Sort sources in the primary room first
        if (leg.destination.roomName === primaryRoom) {
          return 0
        }

        return 1;
      },
      'remaining'
    );

    const leg = sortedLegs.shift();
    if (!leg) {
      trace.error('no legs to build');
      return;
    }

    trace.notice('shortest leg',)

    this.selectedLeg = leg;

    let roadSites = 0;
    for (let i = 0; i < leg.path.length; i++) {
      if (roadSites > MAX_ROAD_SITES) {
        trace.log('too many road sites', {roadSites});
        return; // We have max sites, dont build any more
      }

      const pos = leg.path[i];

      if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
        trace.log('skip border site', {pos});
        continue;
      }

      const road = pos.lookFor(LOOK_STRUCTURES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });

      if (road) {
        continue;
      }

      const roadSite = pos.lookFor(LOOK_CONSTRUCTION_SITES).find((s) => {
        return s.structureType === STRUCTURE_ROAD;
      });
      if (roadSite) {
        roadSites += 1;
        continue;
      }

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

const visualizeLegs = (legs: Leg[], trace: Tracer) => {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    new RoomVisual(leg.destination.roomName).text('X', leg.destination.x, leg.destination.y);
  }
}
