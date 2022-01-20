


export const getPrioritizedSites = function (room: Room): ConstructionSite[] {
  let sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (!sites || !sites.length) {
    return [];
  }

  sites = _.sortBy(sites, (site) => {
    switch (site.structureType) {
      case STRUCTURE_SPAWN:
        return 0 - site.progress / site.progressTotal;
      case STRUCTURE_TOWER:
        return 1 - site.progress / site.progressTotal;
      case STRUCTURE_RAMPART:
        return 2 - site.progress / site.progressTotal;
      case STRUCTURE_WALL:
        return 3 - site.progress / site.progressTotal;
      case STRUCTURE_STORAGE:
        return 4 - site.progress / site.progressTotal;
      case STRUCTURE_EXTENSION:
        return 5 - site.progress / site.progressTotal;
      case STRUCTURE_LINK:
        return 6 - site.progress / site.progressTotal;
      case STRUCTURE_TERMINAL:
        return 7 - site.progress / site.progressTotal;
      case STRUCTURE_EXTRACTOR:
        return 8 - site.progress / site.progressTotal;
      case STRUCTURE_LAB:
        return 9 - site.progress / site.progressTotal;
      case STRUCTURE_CONTAINER:
        return 10 - site.progress / site.progressTotal;
      case STRUCTURE_ROAD:
        return 20 - site.progress / site.progressTotal;
      default:
        return 15 - site.progress / site.progressTotal;
    }
  });

  return sites;
}
