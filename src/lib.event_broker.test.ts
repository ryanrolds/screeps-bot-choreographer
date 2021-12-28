import 'mocha';
import * as _ from "lodash";
import {expect} from 'chai';
import {EventBroker, Stream, Consumer, NotAttachedError, Event} from './lib.event_broker';

describe('Event Broker', function () {
  context('broker', () => {
    let broker: EventBroker = null;

    beforeEach(() => {
      broker = new EventBroker();
    });

    it('should be able to get a stream', () => {
      const test = broker.getStream('test')
      expect(test).to.be.an.instanceOf(Stream);

      const test2 = broker.getStream('test2')
      expect(test2).to.be.an.instanceOf(Stream);
      expect(test).to.not.equal(test2);

      const dupe = broker.getStream('test')
      expect(dupe).to.equal(test);
    });
  });

  context('steam', () => {
    it('should be able to get consumer for stream', () => {
      const broker = new EventBroker();
      const test = broker.getStream('test');
      const consumer = test.addConsumer('test');
      expect(consumer).to.be.an.instanceOf(Consumer);
    });

    it('should allow removing consumer', () => {
      const broker = new EventBroker();
      const test = broker.getStream('test');
      const consumer = test.addConsumer('test');

      const events = consumer.getEvents()
      expect(events).to.be.an.instanceOf(Array);
      expect(events.length).to.equal(0);

      test.removeConsumer(consumer);
      expect(() => consumer.getEvents()).to.throw(NotAttachedError);
    });

    it('should allow compacting a stream', () => {
      const broker = new EventBroker();
      const stream = broker.getStream('test');
      const consumer = stream.addConsumer('test');

      stream.publish(new Event('test', 1, 'test', {}));

      expect(stream.getLength()).to.equal(1);
      expect(consumer.getOffset()).to.equal(0);

      stream.removeConsumed();

      expect(stream.getLength()).to.equal(1);
      expect(consumer.getOffset()).to.equal(0);

      const events = consumer.getEvents()
      expect(events).to.be.an.instanceOf(Array);
      expect(events.length).to.equal(1);

      expect(stream.getLength()).to.equal(1);
      expect(consumer.getOffset()).to.equal(1);

      stream.removeConsumed();

      expect(stream.getLength()).to.equal(0);
      expect(consumer.getOffset()).to.equal(0);
    });
  });

  context('consumer', () => {
    it('should allow getting events', () => {
      const broker = new EventBroker();
      const test = broker.getStream('test');
      const consumer = test.addConsumer('test');

      test.publish(new Event('test', 1, 'test', {}));

      const events = consumer.getEvents()
      expect(events).to.be.an.instanceOf(Array);
      expect(events.length).to.equal(1);

      const moreEvents = consumer.getEvents()
      expect(moreEvents).to.be.an.instanceOf(Array);
      expect(moreEvents.length).to.equal(0);
    })
  });
});
