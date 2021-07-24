import {Topics} from './lib.topics';
import {Tracer} from './lib.tracing'
import {Kingdom} from './org.kingdom';
import OrgRoom from './org.room';
import {Scheduler} from './os.scheduler';

export class OrgBase {
  parent: OrgBase;
  id: string;
  trace: any;

  constructor(parent: OrgBase, id: string, trace: Tracer) {
    this.parent = parent;
    this.id = id;
    this.trace = trace.with(this.constructor.name);
  }
  getID(): string {
    return this.id;
  }
  getParent(): OrgBase {
    return this.parent;
  }
  getKingdom(): Kingdom {
    return this.getParent().getKingdom();
  }
  getColony() {
    return this.getParent().getColony();
  }
  getRoom(): OrgRoom {
    return this.getParent().getRoom();
  }
  getCreeps(): Creep[] {
    return this.getParent().getCreeps();
  }
  getTopics(): Topics {
    return this.getParent().getTopics();
  }
  getStats() {
    return this.getParent().getStats();
  }
  getScheduler(): Scheduler {
    return this.getParent().getScheduler();
  }
  sendRequest(topic, priority, request, ttl) {
    const parent = this.getParent();
    if (!parent) {
      return;
    }

    parent.sendRequest(topic, priority, request, ttl);
  }
  peekNextRequest(topic: string) {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.peekNextRequest(topic);
  }
  getNextRequest(topic: string) {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.getNextRequest(topic);
  }
  getTopicLength(topic: string) {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.getTopicLength(topic);
  }
  getFilteredRequests(topicId: string, filter: (arg: any) => boolean): any[] {
    const parent = this.getParent();
    if (!parent) {
      return [];
    }

    return parent.getFilteredRequests(topicId, filter);
  }
}


