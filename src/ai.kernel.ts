import {CreepManager} from "./ai.creeps";
import {ShardConfig} from "./config";

export interface Kernel {
  config: ShardConfig;
  creepManager: CreepManager;

}
