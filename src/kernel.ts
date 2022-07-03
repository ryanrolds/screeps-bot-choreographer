import {CreepManager} from "./ai.creeps";
import {ShardConfig} from "./config";
import {CostMatrixCache} from "./lib.costmatrix_cache";
import {EventBroker} from "./lib.event_broker";
import {PathCache} from "./lib.path_cache";
import {Topics} from "./lib.topics";
import {Scheduler} from "./os.scheduler";
import {CentralPlanning} from "./runnable.central_planning";
import {Scribe} from "./runnable.scribe";

export interface Kernel {
  getConfig(): ShardConfig;
  getTopics(): Topics;
  getBroker(): EventBroker;
  getScheduler(): Scheduler;
  getCreepsManager(): CreepManager;
  getScribe(): Scribe;
  getPlanner(): CentralPlanning;
  getPathCache(): PathCache;
  getCostMatrixCache(): CostMatrixCache;

  getFriends(): string[];
  getAvoid(): string[];
  getKOS(): string[];
}
