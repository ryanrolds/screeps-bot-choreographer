
const DEFAULT_TTL = 500;
class Topics {
  constructor() {
    this.topics = {};
  }
  getTopic(topic) {
    if (!this.topics[topic]) {
      return null;
    }

    return this.topics[topic];
  }
  setTopic(topic, value) {
    if (!this.topics[topic]) {
      return null;
    }

    this.topics[topic] = value;
  }
  reset() {
    this.topics = {};
  }
  removeStale() {
    Object.keys(this.topics).forEach((topicId) => {
      this.topics[topicId] = this.topics[topicId].filter((request) => {
        return request.ttl > Game.time;
      });
    });
  }
  createTopic(topic) {
    this.topics[topic] = [];
    return this.topics[topic];
  }
  addRequest(topicID, priority, details, ttl = DEFAULT_TTL) {
    let topic = this.getTopic(topicID);
    if (!topic) {
      topic = this.createTopic(topicID);
    }

    const request = {
      priority,
      details,
      ttl: Game.time + ttl,
    };

    topic.push(request);
    this.topics[topicID] = _.sortBy(topic, 'priority');
  }
  peekNextRequest(topicID) {
    const topic = this.getTopic(topicID);
    if (!topic) {
      return null;
    }

    if (!topic.length) {
      return null;
    }

    return topic[topic.length - 1];
  }
  getNextRequest(topicID) {
    const topic = this.getTopic(topicID);
    if (!topic) {
      return null;
    }

    let request = null;
    while (request = topic.pop()) {
      if (request.ttl < Game.time) {
        continue;
      }

      break;
    }

    this.setTopic(topicID, topic);

    return request;
  }
  getMessageOfMyChoice(topicId, chooser) {
    const messages = this.getTopic(topicId);
    if (!messages) {
      return null;
    }

    const choice = chooser(messages);
    if (choice) {
      _.remove(messages, choice);
    }

    this.setTopic(topicId, messages);

    return choice;
  }
  getLength(topicID) {
    const topic = this.topics[topicID];
    if (!topic) {
      return 0;
    }

    return topic.length;
  }
  getCounts() {
    return _.reduce(this.topics, (acc, topic, key) => {
      acc[key] = topic.length;

      return acc;
    }, {});
  }
}

module.exports = Topics;
