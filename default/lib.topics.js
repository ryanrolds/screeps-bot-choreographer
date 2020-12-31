
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
  createTopic(topic) {
    this.topics[topic] = [];
    return this.topics[topic];
  }
  addRequest(topicID, priority, details) {
    let topic = this.getTopic(topicID);
    if (!topic) {
      topic = this.createTopic(topicID);
    }

    const request = {
      priority,
      details,
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

    const request = topic.pop();

    this.setTopic(topicID, topic);

    return request;
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
