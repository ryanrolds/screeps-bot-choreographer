export class OrgBase {
  parent: OrgBase;
  id: string;
  trace: any;

  constructor(parent: OrgBase, id: string, trace) {
    this.parent = parent;
    this.id = id;
    this.trace = trace.with(this.constructor.name);
  }
  getID() {
    return this.id;
  }
  getParent() {
    return this.parent;
  }
  getKingdom() {
    return this.getParent().getKingdom();
  }
  getColony() {
    return this.getParent().getColony();
  }
  getRoom() {
    return this.getParent().getRoom();
  }
  getCreeps() {
    return this.getParent().getCreeps();
  }
  getTopics() {
    return this.getParent().getTopics();
  }
  getStats() {
    return this.getParent().getStats();
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
}

module.exports = OrgBase;
