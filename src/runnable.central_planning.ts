import {KingdomConfig} from "./config";
import {AI} from "./lib.ai";
import {Tracer} from "./lib.tracing";
import {Kingdom} from "./org.kingdom";
import {RunnableResult, running} from "./os.process";

export class CentralPlanning {
  config: KingdomConfig;
  username: string;
  buffer: number;


  constructor(config: KingdomConfig) {
    this.config = config;
  }

  run(kingdom: Kingdom, trace: Tracer): RunnableResult {
    return running();
  }

  getUsername() {

  }

  setUsername() {

  }

  getBuffer() {

  }

  setBuffer() {

  }

  addColony() {

  }

  removeColony() {

  }
}
