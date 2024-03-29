
export type PriceRange = {
  min: number,
  max: number,
}

export const PRICES = new Map<ResourceConstant, PriceRange>([
  [RESOURCE_ENERGY, {max: 10, min: 1.0}],
  [RESOURCE_POWER, {max: 100, min: 10}],
  [RESOURCE_OPS, {max: 100, min: 10}],

  [RESOURCE_HYDROGEN, {max: 5, min: 0.6}],
  [RESOURCE_OXYGEN, {max: 5, min: 0.3}],
  [RESOURCE_HYDROXIDE, {max: 10, min: 0.5}],

  [RESOURCE_LEMERGIUM, {max: 10, min: 0.2}],
  [RESOURCE_UTRIUM, {max: 10, min: 0.4}],
  [RESOURCE_UTRIUM_LEMERGITE, {max: 10, min: 1.0}],

  [RESOURCE_KEANIUM, {max: 10, min: 0.2}],
  [RESOURCE_ZYNTHIUM, {max: 10, min: 0.1}],
  [RESOURCE_ZYNTHIUM_KEANITE, {max: 10, min: 0.5}],

  [RESOURCE_GHODIUM, {max: 10, min: 2.0}],
  [RESOURCE_CATALYST, {max: 20, min: 0.5}],

  [RESOURCE_GHODIUM_HYDRIDE, {max: 10, min: 0.5}],
  [RESOURCE_GHODIUM_OXIDE, {max: 10, min: 0.5}],
  [RESOURCE_GHODIUM_ACID, {max: 10, min: 0.5}],
  [RESOURCE_GHODIUM_ALKALIDE, {max: 10, min: 0.5}],
  [RESOURCE_CATALYZED_GHODIUM_ACID, {max: 30.0, min: 17}],
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE, {max: 30.0, min: 12.0}],

  [RESOURCE_KEANIUM_HYDRIDE, {max: 10, min: 0.5}],
  [RESOURCE_KEANIUM_OXIDE, {max: 10, min: 0.5}],
  [RESOURCE_KEANIUM_ACID, {max: 10, min: 0.5}],
  [RESOURCE_KEANIUM_ALKALIDE, {max: 10, min: 0.5}],
  [RESOURCE_CATALYZED_KEANIUM_ACID, {max: 30, min: 0.5}],
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE, {max: 30, min: 10.0}],

  [RESOURCE_LEMERGIUM_HYDRIDE, {max: 10, min: 0.5}],
  [RESOURCE_LEMERGIUM_OXIDE, {max: 10, min: 0.5}],
  [RESOURCE_LEMERGIUM_ACID, {max: 10, min: 0.5}],
  [RESOURCE_LEMERGIUM_ALKALIDE, {max: 10, min: 0.5}],
  [RESOURCE_CATALYZED_LEMERGIUM_ACID, {max: 30, min: 0.5}],
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, {max: 30, min: 8.0}],

  [RESOURCE_UTRIUM_HYDRIDE, {max: 10, min: 0.5}],
  [RESOURCE_UTRIUM_OXIDE, {max: 10, min: 0.5}],
  [RESOURCE_UTRIUM_ACID, {max: 10, min: 0.5}],
  [RESOURCE_UTRIUM_ALKALIDE, {max: 10, min: 0.5}],
  [RESOURCE_CATALYZED_UTRIUM_ACID, {max: 30, min: 2.000}],
  [RESOURCE_CATALYZED_UTRIUM_ALKALIDE, {max: 30, min: 5}],

  [RESOURCE_ZYNTHIUM_HYDRIDE, {max: 10, min: 0.5}],
  [RESOURCE_ZYNTHIUM_OXIDE, {max: 10, min: 0.5}],
  [RESOURCE_ZYNTHIUM_ACID, {max: 10, min: 0.5}],
  [RESOURCE_ZYNTHIUM_ALKALIDE, {max: 10, min: 0.5}],
  [RESOURCE_CATALYZED_ZYNTHIUM_ACID, {max: 30, min: 0.5}],
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE, {max: 30, min: 5}],

  [RESOURCE_SILICON, {max: 100, min: 10}],
  [RESOURCE_METAL, {max: 100, min: 10}],
  [RESOURCE_BIOMASS, {max: 100, min: 10}],
  [RESOURCE_MIST, {max: 100, min: 10}],

  [RESOURCE_UTRIUM_BAR, {max: 100, min: 10}],
  [RESOURCE_LEMERGIUM_BAR, {max: 100, min: 10}],
  [RESOURCE_ZYNTHIUM_BAR, {max: 100, min: 10}],
  [RESOURCE_KEANIUM_BAR, {max: 100, min: 10}],
  [RESOURCE_GHODIUM_MELT, {max: 100, min: 10}],
  [RESOURCE_OXIDANT, {max: 100, min: 10}],
  [RESOURCE_REDUCTANT, {max: 100, min: 10}],
  [RESOURCE_PURIFIER, {max: 100, min: 10}],
  [RESOURCE_BATTERY, {max: 100, min: 10}],

  [RESOURCE_COMPOSITE, {max: 100, min: 10}],
  [RESOURCE_CRYSTAL, {max: 100, min: 10}],
  [RESOURCE_LIQUID, {max: 100, min: 10}],

  [RESOURCE_WIRE, {max: 100, min: 10}],
  [RESOURCE_SWITCH, {max: 100, min: 10}],
  [RESOURCE_TRANSISTOR, {max: 100, min: 10}],
  [RESOURCE_MICROCHIP, {max: 100, min: 10}],
  [RESOURCE_CIRCUIT, {max: 100, min: 10}],
  [RESOURCE_DEVICE, {max: 100, min: 10}],

  [RESOURCE_CELL, {max: 100, min: 10}],
  [RESOURCE_PHLEGM, {max: 100, min: 10}],
  [RESOURCE_TISSUE, {max: 100, min: 10}],
  [RESOURCE_MUSCLE, {max: 100, min: 10}],
  [RESOURCE_ORGANOID, {max: 100, min: 10}],
  [RESOURCE_ORGANISM, {max: 100, min: 10}],

  [RESOURCE_ALLOY, {max: 100, min: 10}],
  [RESOURCE_TUBE, {max: 100, min: 10}],
  [RESOURCE_FIXTURES, {max: 100, min: 10}],
  [RESOURCE_FRAME, {max: 100, min: 10}],
  [RESOURCE_HYDRAULICS, {max: 100, min: 10}],
  [RESOURCE_MACHINE, {max: 100, min: 10}],

  [RESOURCE_CONDENSATE, {max: 100, min: 10}],
  [RESOURCE_CONCENTRATE, {max: 100, min: 10}],
  [RESOURCE_EXTRACT, {max: 100, min: 10}],
  [RESOURCE_SPIRIT, {max: 100, min: 10}],
  [RESOURCE_EMANATION, {max: 100, min: 10}],
  [RESOURCE_ESSENCE, {max: 100, min: 10}],
]);
