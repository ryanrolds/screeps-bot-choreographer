import {Process, Runnable, RunnableResult, running, sleeping, terminate} from "./os.process";
import {Tracer} from './lib.tracing';
import Kingdom from "./org.kingdom";
import {Priorities, Scheduler} from "./os.scheduler";
import LinkManager from "./manager.links"
import TowerRunnable from "./runnable.tower"
import SourceRunnable from "./runnable.source";
import SpawnManager from "./manager.spawns";
import TerminalRunnable from "./runnable.terminal";
import {LabsManager} from "./manager.labs";

export default class RoomRunnable {
  id: string;
  scheduler: Scheduler;

  constructor(id: string, scheduler: Scheduler) {
    this.id = id;
    this.scheduler = scheduler;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    const room = Game.rooms[this.id];
    if (!room) {
      return terminate();
    }

    const orgRoom = kingdom.getRoomByName(this.id);
    if (!orgRoom) {
      return terminate();
    }

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
          new SpawnManager(orgRoom, spawnManagerId)));
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
          new LabsManager(labsManagerId, orgRoom, this.scheduler)));
      }

      // Terminal runnable
      if (room.terminal) {
        const terminalId = room.terminal.id;
        if (!this.scheduler.hasProcess(terminalId)) {
          this.scheduler.registerProcess(new Process(terminalId, 'terminals', Priorities.LOGISTICS,
            new TerminalRunnable(orgRoom, room.terminal)));
        }
      }

      // Observer runnable
    }

    return sleeping(10);
  }
}
