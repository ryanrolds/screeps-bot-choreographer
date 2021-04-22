import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import {Priorities, Scheduler} from "./os.scheduler";
import LinkManager from "./runnable.manager.links"
import TowerRunnable from "./runnable.tower"
import SourceRunnable from "./runnable.source";
import SpawnManager from "./runnable.manager.spawns";
import TerminalRunnable from "./runnable.terminal";
import {LabsManager} from "./runnable.manager.labs";

const MIN_ENERGY = 10000;
const ENERGY_REQUEST_TTL = 50;

export default class RoomRunnable {
  id: string;
  scheduler: Scheduler;
  requestEnergyTTL: number;
  prevTime: number;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
    this.requestEnergyTTL = ENERGY_REQUEST_TTL;
    this.prevTime = Game.time;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    trace = trace.asId(this.id);

    const ticks = Game.time - this.prevTime;
    this.prevTime = Game.time;

    this.requestEnergyTTL -= ticks;

    trace.log('room run', {
      id: this.id,
    });

    const room = Game.rooms[this.id];
    if (!room) {
      trace.log('cannot find room in game', {});
      return terminate();
    }

    const orgRoom = kingdom.getRoomByName(this.id);
    if (!orgRoom) {
      trace.log('cannot find room in kingdom', {});
      return terminate();
    }

    trace.log('room run', {});

    // Sources
    room.find<FIND_SOURCES>(FIND_SOURCES).forEach((source) => {
      const sourceId = `source_${source.id}`
      if (!this.scheduler.hasProcess(sourceId)) {
        this.scheduler.registerProcess(new Process(sourceId, 'sources', Priorities.RESOURCES,
          new SourceRunnable(orgRoom, source)));
      }
    });

    // Mineral
    const mineral = orgRoom.roomStructures.filter((structure) => {
      return structure.structureType === STRUCTURE_EXTRACTOR;
    }).map((extractor) => {
      const minerals = extractor.pos.findInRange(FIND_MINERALS, 0);
      return minerals[0];
    })[0];
    if (mineral) {
      const mineralId = `mineral_${mineral.id}`
      if (!this.scheduler.hasProcess(mineralId)) {
        this.scheduler.registerProcess(new Process(mineralId, 'mineral', Priorities.RESOURCES,
          new SourceRunnable(orgRoom, mineral)));
      }
    }

    if (orgRoom.isPrimary) {
      // Spawn Manager
      const spawnManagerId = `spawns_${this.id}`
      if (!this.scheduler.hasProcess(spawnManagerId)) {
        this.scheduler.registerProcess(new Process(spawnManagerId, 'spawns', Priorities.DEFENCE,
          new SpawnManager(spawnManagerId, orgRoom)));
      }

      // Towers
      room.find<StructureTower>(FIND_MY_STRUCTURES, {
        filter: structure => structure.structureType === STRUCTURE_TOWER,
      }).forEach((tower) => {
        const towerId = `tower_${tower.id}`
        if (!this.scheduler.hasProcess(towerId)) {
          this.scheduler.registerProcess(new Process(towerId, 'towers', Priorities.DEFENCE,
            new TowerRunnable(orgRoom, tower)));
        }
      });

      // Link Manager
      const linkManagerId = `links_${this.id}`
      if (!this.scheduler.hasProcess(linkManagerId)) {
        this.scheduler.registerProcess(new Process(linkManagerId, 'links', Priorities.LOGISTICS,
          new LinkManager(linkManagerId, orgRoom)));
      }

      // Labs Manager
      const labsManagerId = `labs_${this.id}`;
      if (!this.scheduler.hasProcess(labsManagerId)) {
        this.scheduler.registerProcess(new Process(labsManagerId, 'labs', Priorities.LOGISTICS,
          new LabsManager(labsManagerId, orgRoom, this.scheduler, trace)));
      }


      if (room.terminal) {
        // Terminal runnable
        const terminalId = room.terminal.id;
        if (!this.scheduler.hasProcess(terminalId)) {
          this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.LOGISTICS,
            new TerminalRunnable(orgRoom, room.terminal)));
        }

        const terminalEnergy = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
        const storageEnergy = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;

        trace.log('room energy', {
          requestEnergyTTL: this.requestEnergyTTL,
          terminalEnergy,
          storageEnergy,
        });

        if (storageEnergy + terminalEnergy < MIN_ENERGY && this.requestEnergyTTL < 0) {
          this.requestEnergyTTL = ENERGY_REQUEST_TTL;
          trace.log('requesting energy from governor', {amount: 1000, resource: RESOURCE_ENERGY});
          (orgRoom as any).getKingdom().getResourceGovernor().requestResource(orgRoom,
            RESOURCE_ENERGY, 1000, ENERGY_REQUEST_TTL, trace);
        }
      }

      // Observer runnable
    }

    return sleeping(10);
  }
}
