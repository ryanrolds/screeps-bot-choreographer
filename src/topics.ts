import {TopicKey} from "./lib.topics";

export function getBaseDefenseTopic(baseId: string): TopicKey {
  return `base_${baseId}_defense`;
}

export function getBaseDistributorTopic(baseId: string): TopicKey {
  return `base_${baseId}_distributor`;
}
