

type ConsumerId = string;

class Consumer {
  id: ConsumerId;
  offset: number;
  stream: Stream;

  constructor(id: ConsumerId, stream: Stream) {
    this.id = id;
    this.stream = stream;
    this.offset = stream.getLength();
  }

  getEvents(): Event[] {
    const events = this.stream.getEvents(this.offset);
    this.offset = this.stream.getLength();
    return events;
  }

  detach() {
    this.stream.removeConsumer(this.id);
    this.stream = null;
  }
}

type StreamId = string;

class Stream {
  consumers: Record<ConsumerId, Consumer>;
  events: Event[];

  constructor() {
    this.consumers = {};
    this.events = [];
  }

  getLength() {
    return this.events.length;
  }

  getEvents(offset: number): Event[] {
    const events = this.events.slice(offset);
    return events;
  }

  addConsumer(consumerId: ConsumerId): Consumer {
    const consumer = new Consumer(consumerId, this);
    this.consumers[consumerId] = consumer;

    return consumer;
  }

  removeConsumer(consumerId: ConsumerId) {
    delete this.consumers[consumerId];
  }
}

export class EventBroker {
  streams: Record<StreamId, Stream>

  constructor() {
    this.streams = {};
  }

  getStream(streamId: StreamId): Stream {
    if (!this.streams[streamId]) {
      this.streams[streamId] = new Stream();
    }

    return this.streams[streamId];
  }
}
