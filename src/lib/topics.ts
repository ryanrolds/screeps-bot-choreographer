import {Metrics} from "./metrics";

const DEFAULT_TTL = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RequestDetails = any;

export type Request<T> = {
  priority: number,
  ttl: number,
  details: T,
};

export type TopicKey = string;
type Topic<T> = Array<Request<T>>;

export class Topics {
  topics: Map<TopicKey, Topic<any>>;
  lastCleanup: number;

  constructor() {
    this.topics = new Map();
    this.lastCleanup = 0;
  }

  getTopics(): Map<TopicKey, Topic<any>> {
    return this.topics;
  }

  getTopic<T>(key: TopicKey): Topic<T> {
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

  createTopic<T>(key: TopicKey): Topic<T> {
    this.topics.set(key, []);
    return this.topics.get(key);
  }

  /**
   * @deprecated Use addRequestV2 instead.
   */
  addRequest<T>(key: TopicKey, priority: number, details: T, ttl = DEFAULT_TTL) {
    let topic = this.getTopic<T>(key);
    if (!topic) {
      topic = this.createTopic(key);
    }

    const request: Request<T> = {
      priority,
      details,
      ttl,
    };

    topic.push(request);
    this.topics.set(key, _.sortBy(topic, 'priority'));
  }

  addRequestV2<T>(key: TopicKey, request: Request<T>) {
    let topic = this.getTopic<T>(key);
    if (!topic) {
      topic = this.createTopic(key);
    }

    topic.push(request);

    // TODO doing this each message we push is a bit slow
    this.topics.set(key, _.sortBy(topic, 'priority'));
  }

  peekNextRequest<T>(key: TopicKey): Request<T> {
    const topic = this.getTopic<T>(key);
    if (!topic) {
      return null;
    }

    if (!topic.length) {
      return null;
    }

    return topic[topic.length - 1];
  }

  getNextRequest<T>(key: TopicKey): Request<T> {
    const topic = this.getTopic<T>(key);
    if (!topic) {
      return null;
    }

    let request: Request<T> = null;
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

  getFilteredRequests<T>(key: TopicKey, filter): Request<T>[] {
    const topic = this.getTopic<T>(key);
    if (!topic) {
      return [];
    }

    return topic.filter<Request<T>>(filter);
  }

  getMessageOfMyChoice<T>(key: TopicKey, chooser) {
    const messages = this.getTopic<T>(key);
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

  reportMetrics(metrics: Metrics) {
    // Report topic counts
    for (const [key, value] of this.getTopics()) {
      metrics.gauge(`topic_length`, value.length, {topic: key});
    }
  }
}
