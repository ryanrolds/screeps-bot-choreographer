type ConsumerId = string;

export const NotAttachedError = new Error('Consumer not attached to stream');

export class Event {
  key: string;
  time: number;
  type: string;
  data: any;

  constructor(key: string, time: number, type: string, data: any) {
    this.key = key;
    this.time = time;
    this.type = type;
    this.data = data;
  }
}

export class Consumer {
  id: ConsumerId;
  offset: number;
  stream: Stream;

  constructor(id: ConsumerId, stream: Stream) {
    this.id = id;
    this.stream = stream;
    this.offset = stream.getLength();
  }

  getEvents(): Event[] {
    if (this.stream == null) {
      throw NotAttachedError;
    }

    const events = this.stream.getEvents(this.offset);
    this.offset = this.stream.getLength();
    return events;
  }

  detach() {
    this.stream = null;
  }

  getOffset() {
    return this.offset;
  }

  // When topic compacted, we need the ability to shift each consumers offset
  shiftOffet(shift: number) {
    this.offset -= shift;
  }
}

type StreamId = string;

export class Stream {
  consumers: Map<ConsumerId, Consumer>;
  events: Event[];

  constructor() {
    this.consumers = new Map();
    this.events = [];
  }

  publish(event: Event) {
    this.events.push(event);
  }

  removeConsumed() {
    let minOffset = -1;
    for (const consumer of this.consumers.values()) {
      if (minOffset === -1) {
        minOffset = consumer.getOffset();
      }
      minOffset = Math.min(minOffset, consumer.getOffset());
    }

    if (minOffset > 0) {
      this.events = this.events.slice(minOffset);
      for (const consumer of this.consumers.values()) {
        consumer.shiftOffet(minOffset);
      }
    }
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
    this.consumers.set(consumerId, consumer);

    return consumer;
  }

  removeConsumer(consumer: Consumer) {
    this.consumers.delete(consumer.id);
    consumer.detach();
  }
}

export class EventBroker {
  streams: Map<StreamId, Stream>

  constructor() {
    this.streams = new Map();
  }

  getStream(streamId: StreamId): Stream {
    if (!this.streams.get(streamId)) {
      this.streams.set(streamId, new Stream());
    }

    return this.streams.get(streamId);
  }

  removeConsumed() {
    for (const stream of this.streams.values()) {
      stream.removeConsumed();
    }
  }
}
