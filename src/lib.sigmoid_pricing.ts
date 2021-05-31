type ResourcePrices = Record<ResourceConstant, ResourcePriceRange>;

type ResourcePriceRange = {
  min: number;
  max: number;
};

const OUTBID = 0.001
const MIDPOINT = 10000;
const SLOPE = 1 / 10000;

export interface ResourcePricer {
  getPrice(arg0: ORDER_BUY | ORDER_SELL, arg1: ResourceConstant, arg2: number);
}


export class SigmoidPricing {
  prices: ResourcePrices;

  constructor(prices: ResourcePrices) {
    this.prices = prices;
  }

  getMarketPrice(orderType: ORDER_BUY | ORDER_SELL, resource: ResourceConstant): number {
    let orders = Game.market.getAllOrders({type: orderType, resourceType: resource});
    const myOrderIds = Object.keys(Game.market.orders);
    orders = _.filter(orders, (order) => {
      return myOrderIds.indexOf(order.id) === -1;
    });

    if (!orders.length) {
      return orderType === ORDER_BUY ? 0.001 : null;
    }

    let price = null;

    if (orderType === ORDER_BUY) {
      price = _.max(orders.map(order => order.price));
    } else {
      price = _.min(orders.map(order => order.price));
    }

    return price;
  }

  getPrice(orderType: ORDER_BUY | ORDER_SELL, resource: ResourceConstant, amount: number): number {
    const range = this.prices[resource];
    if (!range) {
      throw new Error(`invalid resource: ${resource}`);
    }

    let price = sigmoid(amount, range.max);

    const marketPrice = this.getMarketPrice(orderType, resource);
    if (marketPrice !== null) {
      if (orderType === ORDER_BUY) {
        price = _.min([marketPrice, price]);
      } else {
        price = _.max([marketPrice, price]);
      }
    }

    if (orderType === ORDER_BUY && price > range.max) {
      price = range.max;
    }

    if (orderType === ORDER_SELL && price < range.min) {
      price = range.min;
    }

    return price;
  }
}

function sigmoid(x: number, max: number, mid: number = MIDPOINT, slope: number = SLOPE): number {
  return max / (1 + Math.pow(Math.E, -slope * (-x + mid)));
}
