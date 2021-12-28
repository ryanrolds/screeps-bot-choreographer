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
  consumers: Record<ConsumerId, Consumer>;
  events: Event[];

  constructor() {
    this.consumers = {};
    this.events = [];
  }

  publish(event: Event) {
    this.events.push(event);
  }

  removeConsumed() {
    const minOffset = Object.values(this.consumers).reduce((min, consumer) => {
      if (min === -1) {
        return consumer.getOffset()
      }

      return Math.min(min, consumer.getOffset());
    }, -1);

    if (minOffset > 0) {
      this.events = this.events.slice(minOffset);
      Object.values(this.consumers).forEach(consumer => {
        consumer.shiftOffet(minOffset);
      });
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
    this.consumers[consumerId] = consumer;

    return consumer;
  }

  removeConsumer(consumer: Consumer) {
    delete this.consumers[consumer.id];
    consumer.detach();
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

  removeConsumed() {
    Object.values(this.streams).forEach(stream => {
      stream.removeConsumed();
    });
  }

  getStats() {
    const stats = {};
    _.each(this.streams, (stream, id) => {
      stats[id] = {
        length: stream.getLength(),
        consumers: Object.keys(stream.consumers).length,
        offsets: Object.values(stream.consumers).reduce((acc, consumer) => {
          return acc + consumer.getOffset();
        }, 0),
      };
    });

    return stats;
  }
}
