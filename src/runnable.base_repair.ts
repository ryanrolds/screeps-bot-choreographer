this.damagedStructures = [];
this.updateDamagedStructure = thread('damaged_structures_thread', UPDATE_DAMAGED_STRUCTURES_TTL)(() => {
  const damagedStructures = this.room.find(FIND_STRUCTURES, {
    filter: (s) => {
      return s.hits < s.hitsMax && (
        s.structureType != STRUCTURE_WALL && s.structureType != STRUCTURE_RAMPART &&
        s.structureType != STRUCTURE_ROAD);
    },
  });

  this.damagedStructures = _.map(damagedStructures, 'id');
});

this.defenseHitsLimit = 10000;
this.damagedSecondaryStructures = [];
this.updateDamagedSecondaryStructures = thread('secondary_structures_thread', UPDATE_DAMAGED_SECONDARY_TTL)(() => {
  const rcLevel = room.controller.level.toString();
  const rcLevelHitsMax = RAMPART_HITS_MAX[rcLevel] || 10000;

  const energyFullness = this.getEnergyFullness() * 10;
  this.defenseHitsLimit = rcLevelHitsMax * Math.pow(0.45, (10 - energyFullness));

  if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) {
    this.defenseHitsLimit = 10000;
  }

  // If energy in reserve is less then we need to sustain a max ugprader,
  // then limit the amount our defense hits
  const reserveEnergy = this.getAmountInReserve(RESOURCE_ENERGY);
  const reserveBuffer = this.getReserveBuffer();
  if (reserveEnergy < reserveBuffer + UPGRADER_BUFFER) {
    this.defenseHitsLimit = _.min([this.defenseHitsLimit, MAX_WALL_HITS]);
  }

  let damagedSecondaryStructures = this.room.find(FIND_STRUCTURES, {
    filter: (s) => {
      return s.hits < s.hitsMax && (
        s.structureType == STRUCTURE_RAMPART ||
        s.structureType == STRUCTURE_WALL) &&
        s.hits < this.defenseHitsLimit;
    },
  });
  damagedSecondaryStructures = _.sortBy(damagedSecondaryStructures, (structure) => {
    return structure.hits;
  });

  this.damagedSecondaryStructures = _.map(damagedSecondaryStructures, 'id');
  trace.log('damaged secondary structures', {
    room: this.id,
    defenseHitsLimit: this.defenseHitsLimit,
    damagedSecondaryStructures: this.damagedSecondaryStructures
  });
});
