import * as MEMORY from './constants.memory';
import * as behaviorTree from './lib.behaviortree';
import {SUCCESS} from './lib.behaviortree';

export const setCommuteDuration = behaviorTree.leafNode(
  'bt.harvest.setCommuteDuration',
  (creep) => {
    const startTick = creep.memory[MEMORY.MEMORY_START_TICK];
    // Only set commute if we have a start tick and if we have not already
    // set the commute time
    if (startTick && !creep.memory[MEMORY.MEMORY_COMMUTE_DURATION]) {
      const commuteTime = Game.time - startTick + creep.body.length;
      creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] = commuteTime;
    }

    return SUCCESS;
  },
);

export const creepIsFresh = (creep: Creep) => {
  if (creep.spawning) {
    return true;
  }

  const commute = creep.memory[MEMORY.MEMORY_COMMUTE_DURATION] || 150;
  const buildTime = creep.body.length * 3;

  return creep.ticksToLive > (commute + buildTime);
};
