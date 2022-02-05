

export function getBaseDefenseTopic(baseId: string): string {
  return `base_${baseId}_defense`;
}

export function getBaseHaulerTopic(baseId: string): string {
  return `base_${baseId}_hauler`;
}

export function getBaseDistributorTopic(baseId: string): string {
  return `base_${baseId}_distributor`;
}

export function getBaseSpawnTopic(baseId: string) {
  return `base_${baseId}_spawn`;
}
