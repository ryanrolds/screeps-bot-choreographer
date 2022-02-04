const DEFAULT_TTL = 500;

export type RequestDetails = any;

export type Request = {
  priority: number,
  details: RequestDetails,
  ttl: number,
};

type TopicKey = string;
type Topic = Array<Request>;

export class Topics {
  topics: Record<TopicKey, Topic>;
  lastCleanup: number;

  constructor() {
    this.topics = {};
    this.lastCleanup = 0;
  }

  getTopic(key: TopicKey): Topic {
    if (this.lastCleanup < Game.time) {
      this.removeStale();
    }

    if (!this.topics[key]) {
      return null;
    }

    return this.topics[key];
  }

  setTopic(key: TopicKey, value) {
    if (!this.topics[key]) {
      return null;
    }

    this.topics[key] = value;
  }
  reset() {
    this.topics = {};
  }
  removeStale() {
    Object.keys(this.topics).forEach((topicId) => {
      this.topics[topicId] = this.topics[topicId].filter((request) => {
        return request.ttl >= Game.time;
      });
    });
    this.lastCleanup = Game.time;
  }
  createTopic(key: TopicKey) {
    this.topics[key] = [];
    return this.topics[key];
  }
  addRequest(key: TopicKey, priority, details: RequestDetails, ttl = DEFAULT_TTL) {
    let topic = this.getTopic(key);
    if (!topic) {
      topic = this.createTopic(key);
    }

    const request = {
      priority,
      details,
      ttl: Game.time + ttl,
    };

    topic.push(request);
    this.topics[key] = _.sortBy(topic, 'priority');
  }
  peekNextRequest(key: TopicKey) {
    const topic = this.getTopic(key);
    if (!topic) {
      return null;
    }

    if (!topic.length) {
      return null;
    }

    return topic[topic.length - 1];
  }
  getNextRequest(key: TopicKey) {
    const topic = this.getTopic(key);
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

    this.setTopic(key, topic);

    return request;
  }
  getFilteredRequests(key: TopicKey, filter) {
    const requests = this.getTopic(key);
    if (!requests) {
      return [];
    }

    return requests.filter(filter);
  }
  getMessageOfMyChoice(key: TopicKey, chooser) {
    const messages = this.getTopic(key);
    if (!messages) {
      return null;
    }

    const choice = chooser(messages);
    if (choice) {
      _.remove(messages, choice);
    }

    this.setTopic(key, messages);

    return choice;
  }
  getLength(key: TopicKey) {
    const topic = this.topics[key];
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
