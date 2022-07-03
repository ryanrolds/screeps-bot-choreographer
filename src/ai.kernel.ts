import {CreepManager} from "./ai.creeps";
import {ShardConfig} from "./config";
import {EventBroker} from "./lib.event_broker";
import {PathCache} from "./lib.path_cache";
import {Topics} from "./lib.topics";
import {Scheduler} from "./os.scheduler";
import {CentralPlanning} from "./runnable.central_planning";
import {Scribe} from "./runnable.scribe";

export interface Kernel {
  getConfig(): ShardConfig;
  getTopics(): Topics;
  getEventBroker(): EventBroker;
  getScheduler(): Scheduler;
  getCreepsManager(): CreepManager;
  getScribe(): Scribe;
  getPlanning(): CentralPlanning;
  getPathCache(): PathCache;
}
