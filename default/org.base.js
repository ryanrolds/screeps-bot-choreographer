class OrgBase {
  constructor(parent, id) {
    this.parent = parent;
    this.id = id;
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
  getStats() {
    return this.getParent().getStats();
  }
  sendRequest(topic, priority, request) {
    const parent = this.getParent();
    if (!parent) {
      return;
    }

    parent.sendRequest(topic, priority, request);
  }
  peekNextRequest() {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.peekNextRequest(topic);
  }
  getNextRequest(topic) {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.getNextRequest(topic);
  }
  getTopicLength(topic) {
    const parent = this.getParent();
    if (!parent) {
      return null;
    }

    return parent.getTopicLength(topic);
  }
}

module.exports = OrgBase;
