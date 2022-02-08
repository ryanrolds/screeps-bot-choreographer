import {Request, RequestDetails, Topics} from './lib.topics';
import {Tracer} from './lib.tracing'
import {Kingdom} from './org.kingdom';
import OrgRoom from './org.room';
import {Colony} from './org.colony';
import {Scheduler} from './os.scheduler';
import {EventBroker} from './lib.event_broker';
import Resources from './org.resource_governor';

export class OrgParent {
  parent: OrgParent;
  id: string;
  trace: any;

  constructor(parent: OrgParent, id: string, trace: Tracer) {
    this.parent = parent;
    this.id = id;
    this.trace = trace;
  }

  getID(): string {
    return this.id;
  }

  getParent(): OrgParent {
    return this.parent;
  }

  getBroker(): EventBroker {
    return this.parent.getBroker();
  }

  getResourceGovernor(): Resources {
    return this.getParent().getResourceGovernor();
  }

  getKingdom(): Kingdom {
    return this.getParent().getKingdom();
  }

  getColony(): Colony {
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

  sendRequest(topic: string, priority: number, details: RequestDetails, ttl: number) {
    const parent = this.getParent();
    if (!parent) {
      return;
    }

    parent.sendRequest(topic, priority, details, ttl);
  }

  peekNextRequest(topic: string): Request {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.peekNextRequest(topic);
  }

  getNextRequest(topic: string): Request {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.getNextRequest(topic);
  }

  getTopicLength(topic: string): number {
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
