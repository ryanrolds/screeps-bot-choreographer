const DEFAULT_TTL = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RequestDetails = any;

export type Request = {
  priority: number,
  details: RequestDetails,
  ttl: number,
};

export type TopicKey = string;
type Topic = Array<Request>;

export class Topics {
  topics: Map<TopicKey, Topic>;
  lastCleanup: number;

  constructor() {
    this.topics = new Map();
    this.lastCleanup = 0;
  }

  getTopic(key: TopicKey): Topic {
    if (this.lastCleanup < Game.time) {
      this.removeStale();
    }

    if (!this.topics.has(key)) {
      return null;
    }

    return this.topics.get(key);
  }

  setTopic(key: TopicKey, value) {
    if (!this.topics.has(key)) {
      return null;
    }

    this.topics.set(key, value);
  }

  reset() {
    this.topics = new Map();
  }

  removeStale() {
    for (const [key, _topic] of this.topics) {
      this.topics.set(key, this.topics.get(key).filter((request) => {
        return request.ttl >= Game.time;
      }));
    }

    this.lastCleanup = Game.time;
  }

  createTopic(key: TopicKey): Topic {
    this.topics.set(key, []);
    return this.topics.get(key);
  }

  /**
   * @deprecated Use addRequestV2 instead.
   */
  addRequest(key: TopicKey, priority: number, details: RequestDetails, ttl = DEFAULT_TTL) {
    let topic = this.getTopic(key);
    if (!topic) {
      topic = this.createTopic(key);
    }

    const request: Request = {
      priority,
      details,
      ttl: Game.time + ttl,
    };

    topic.push(request);
    this.topics.set(key, _.sortBy(topic, 'priority'));
  }

  addRequestV2(key: TopicKey, request: Request) {
    let topic = this.getTopic(key);
    if (!topic) {
      topic = this.createTopic(key);
    }

    // Add current game time to tll so we know when to expire the message
    request.ttl = Game.time + request.ttl;

    topic.push(request);

    // TODO doing this each message we push is a bit slow
    this.topics.set(key, _.sortBy(topic, 'priority'));
  }

  peekNextRequest(key: TopicKey): Request {
    const topic = this.getTopic(key);
    if (!topic) {
      return null;
    }

    if (!topic.length) {
      return null;
    }

    return topic[topic.length - 1];
  }

  getNextRequest(key: TopicKey): Request {
    const topic = this.getTopic(key);
    if (!topic) {
      return null;
    }

    let request = null;
    // eslint-disable-next-line no-cond-assign
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
    const topic = this.topics.get(key);
    if (!topic) {
      return 0;
    }

    return topic.length;
  }
}
