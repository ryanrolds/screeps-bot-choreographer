const PRICES = {
  energy: {sell: 3, buy: 1.5},
  H: {sell: 3, buy: 0.45},
  O: {sell: 0.85, buy: 0.1},
  Z: {sell: 0.2, buy: 0.09},
  K: {sell: 0.25, buy: 0.08},
  U: {sell: 0.5, buy: 0.15},
  L: {sell: 0.3, buy: 0.09},
  G: {sell: 11.0, buy: 0.5},
  X: {sell: 3.49, buy: 0.9},
  OH: {sell: 2, buy: 0.3},
  ZK: {sell: 2.0, buy: 0.4},
  UL: {sell: 3, buy: 0.2},
  LH: {sell: 1.5, buy: 0.3},
  ZH: {sell: 0.4, buy: 0.05},
  GH: {sell: 5, buy: 1.5},
  KH: {sell: 0.2, buy: 0.003},
  UH: {sell: 0.42, buy: 0.1},
  LO: {sell: 1.2, buy: 0.1},
  ZO: {sell: 0.2, buy: 0.003},
  KO: {sell: 0.5, buy: 0.25},
  UO: {sell: 1.4, buy: 0.003},
  GO: {sell: 1, buy: 0.2},
  LH2O: {sell: 3.5, buy: 0.003},
  KH2O: {sell: 1.7, buy: 0.003},
  ZH2O: {sell: 1.3, buy: 0.003},
  UH2O: {sell: 3.0, buy: 0.003},
  GH2O: {sell: 5.0, buy: 2.02},
  LHO2: {sell: 1.17, buy: 0.3},
  UHO2: {sell: 5.1, buy: 0.003},
  KHO2: {sell: 3.2, buy: 0.3},
  ZHO2: {sell: 1.3, buy: 0.003},
  GHO2: {sell: 2, buy: 0.4},
  XLH2O: {sell: 4.6, buy: 0.004},
  XKH2O: {sell: 14.5, buy: 0.003},
  XZH2O: {sell: 3.0, buy: 0.003},
  XUH2O: {sell: 9.9, buy: 2.000},
  XGH2O: {sell: 10.0, buy: 0.003},
  XLHO2: {sell: 2.5, buy: 0.003},
  XUHO2: {sell: 9.9, buy: 0.003},
  XKHO2: {sell: 4.8, buy: 3.6},
  XZHO2: {sell: 4.6, buy: 0.003},
  XGHO2: {sell: 8, buy: 0.004},
};

const getOptimalBuyPrice = (resource, maxPrice) => {
  // Get price closet to max price without going over, add 0.001
  // Return optimal price
};

const getOptimalSellPrice = (resource, minPrice) => {
  // Get price closest to min price without going under, subtract 0.001
  // Return optimal price
};

module.exports = {
  PRICES,
  getOptimalBuyPrice,
  getOptimalSellPrice,
};
