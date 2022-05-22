import {TopicKey} from "./lib.topics";

export function getBaseDefenseTopic(baseId: string): TopicKey {
  return `base_${baseId}_defense`;
}

export function getBaseHaulerTopic(baseId: string): TopicKey {
  return `base_${baseId}_hauler`;
}

export function getBaseDistributorTopic(baseId: string): TopicKey {
  return `base_${baseId}_distributor`;
}
