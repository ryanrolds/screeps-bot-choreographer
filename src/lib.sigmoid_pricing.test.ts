import 'mocha';
import {expect} from 'chai';
import * as _ from "lodash";
import Sinon, * as sinon from 'sinon';
import {stubObject, StubbedInstance} from "ts-sinon";
import {setup, mockGlobal, mockInstanceOf} from "screeps-test-helper";

import {SigmoidPricing} from './lib.sigmoid_pricing';

describe('Sigmoid Pricing', function () {
  const prices = {
    [RESOURCE_HYDROXIDE]: {max: 5, min: 0.5},
  }
  const pricer = new SigmoidPricing(prices as any);
  let orders: Record<string, Order> = mockInstanceOf<Record<string, Order>>({
    '01': {
      id: '01',
      type: ORDER_SELL,
      price: 3.5,
      resourceType: RESOURCE_HYDROXIDE,
    },
    '02': {
      id: '02',
      type: ORDER_SELL,
      price: 1.5,
      resourceType: RESOURCE_HYDROXIDE,
    },
    '03': {
      id: '03',
      type: ORDER_BUY,
      price: 3.0,
      resourceType: RESOURCE_HYDROXIDE,
    },
    '04': {
      id: '04',
      type: ORDER_BUY,
      price: 1.0,
      resourceType: RESOURCE_HYDROXIDE,
    },
  });

  beforeEach(() => {
    mockGlobal<Game>('Game', {
      market: {
        orders: {},
        getAllOrders: (filter) => {
          return [];
        },
      }
    });
  })

  describe('getMarketPrice', function () {
    beforeEach(() => {
      mockGlobal<Game>('Game', {
        market: {
          orders: {},
          getAllOrders: (filter) => {
            return _.filter(Object.values(orders), filter);
          },
        },
      });
    });

    it('should return null if no orders', () => {
      const price = pricer.getMarketPrice(ORDER_SELL, RESOURCE_GHODIUM);
      expect(price).to.be.null;
    });

    it('should return buy price', () => {
      const price = pricer.getMarketPrice(ORDER_BUY, RESOURCE_HYDROXIDE);
      expect(price).to.equal(3);
    });

    it('should return sell price', () => {
      const price = pricer.getMarketPrice(ORDER_SELL, RESOURCE_HYDROXIDE);
      expect(price).to.equal(1.5);
    });
  });

  describe('getPrice', function () {
    it('should throw error if invalid resource', () => {
      expect(() => {
        pricer.getPrice(ORDER_BUY, 'not a real resource' as any, 100000)
      }).to.throw('invalid resource: not a real resource');
    });

    describe('no orders', () => {
      it('should return absolute minimum if no orders for a buy', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 0);
        expect(price).to.equal(0.001);
      });

      it('should return high price when selling resource we do not have', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 0);
        expect(price).to.equal(3.6552928931500244);
      });

      it('should return absolute minimum if no orders when buying resources we have 50k', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 10000);
        expect(price).to.equal(0.001);
      });

      it('should return middle price when selling resources we have 50k', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 10000);
        expect(price).to.equal(2.5);
      });

      it('should return minimum price when selling a resource we have a lot of', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 100000);
        expect(price).to.equal(0.5);
      });
    });

    describe('with orders', () => {
      beforeEach(() => {
        mockGlobal<Game>('Game', {
          market: {
            orders: {},
            getAllOrders: (filter) => {
              return _.filter(Object.values(orders), filter);
            },
          },
        });
      });

      it('should return high price when buying resource we do not have', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 0);
        expect(price).to.equal(3);
      });

      it('should return high price when selling resource we do not have', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 0);
        expect(price).to.equal(3.6552928931500244);
      });

      it('should return middle price when buying resources we have 50k', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 10000);
        expect(price).to.equal(2.5);
      });

      it('should return middle price when selling resources we have 50k', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 10000);
        expect(price).to.equal(2.5);
      });

      it('should return market price when buying a resource we have a lot of', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 100000);
        expect(price).to.equal(0.0006169728799311589);
      });

      it('should return market price when selling a resource we have a lot of', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 100000);
        expect(price).to.equal(1.5);
      });
    });

    describe('with my orders too', () => {
      beforeEach(() => {
        mockGlobal<Game>('Game', {
          market: {
            orders: {
              '02': {
                id: '02',
                type: ORDER_SELL,
                price: 1.5,
                resourceType: RESOURCE_HYDROXIDE,
              },
              '03': {
                id: '03',
                type: ORDER_BUY,
                price: 3.0,
                resourceType: RESOURCE_HYDROXIDE,
              },
            },
            getAllOrders: (filter) => {
              return _.filter(Object.values(orders), filter);
            },
          },
        });
      });

      it('should return high price when buying resource we do not have', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 0);
        expect(price).to.equal(1);
      });

      it('should return high price when selling resource we do not have', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 0);
        expect(price).to.equal(3.6552928931500244);
      });

      it('should return middle price when buying resources we have 50k', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 10000);
        expect(price).to.equal(1);
      });

      it('should return middle price when selling resources we have 50k', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 10000);
        expect(price).to.equal(3.5);
      });

      it('should return market price when buying a resource we have a lot of', () => {
        const price = pricer.getPrice(ORDER_BUY, RESOURCE_HYDROXIDE, 100000);
        expect(price).to.equal(0.0006169728799311589);
      });

      it('should return market price when selling a resource we have a lot of', () => {
        const price = pricer.getPrice(ORDER_SELL, RESOURCE_HYDROXIDE, 100000);
        expect(price).to.equal(3.5);
      });
    });
  });
});
